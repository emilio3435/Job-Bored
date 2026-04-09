(() => {
  const root =
    window.JobBoredDiscoveryWizard || (window.JobBoredDiscoveryWizard = {});
  const verify = root.verify || (root.verify = {});

  const RESULT_KINDS = new Set([
    "connected_ok",
    "accepted_async",
    "stub_only",
    "access_protected",
    "apps_script_private",
    "network_error",
    "invalid_endpoint",
  ]);

  const ENGINE_STATES = new Set([
    "none",
    "stub_only",
    "unverified",
    "connected",
  ]);

  const RESPONSE_LAYERS = new Set([
    "browser",
    "transport",
    "upstream",
    "downstream",
  ]);

  const DEFAULT_VERIFICATION_RESULT = Object.freeze({
    ok: false,
    kind: "invalid_endpoint",
    engineState: "none",
    httpStatus: 0,
    message: "",
    detail: "",
    layer: "browser",
  });

  function text(raw, fallback = "") {
    const value = raw == null ? "" : String(raw).trim();
    return value || fallback;
  }

  function normalizeUrl(raw) {
    const s = text(raw);
    if (!s) return "";
    try {
      const url = new URL(s);
      url.hash = "";
      return url.toString();
    } catch (_) {
      return "";
    }
  }

  function isLikelyAppsScriptWebAppUrl(raw) {
    const s = text(raw);
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

  function isLikelyCloudflareWorkerUrl(raw) {
    const s = text(raw);
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

  function isLocalOnlyUrl(raw) {
    const s = text(raw);
    if (!s) return false;
    try {
      const url = new URL(s);
      const host = String(url.hostname || "")
        .replace(/^\[|\]$/g, "")
        .toLowerCase();
      return (
        host === "localhost" ||
        host === "127.0.0.1" ||
        host === "::1" ||
        host === "[::1]"
      );
    } catch (_) {
      return false;
    }
  }

  function isWorkerForwardPath(raw) {
    const s = normalizeUrl(raw);
    if (!s) return false;
    try {
      const url = new URL(s);
      return (
        isLikelyCloudflareWorkerUrl(s) &&
        /\/forward\/?$/i.test(url.pathname || "")
      );
    } catch (_) {
      return false;
    }
  }

  function createVerificationResult(partial) {
    const src = partial && typeof partial === "object" ? partial : {};
    const kind = text(src.kind, DEFAULT_VERIFICATION_RESULT.kind);
    const engineState = text(
      src.engineState,
      DEFAULT_VERIFICATION_RESULT.engineState,
    );
    const layer = text(src.layer, DEFAULT_VERIFICATION_RESULT.layer);
    const result = {
      ok: !!src.ok,
      kind: RESULT_KINDS.has(kind) ? kind : DEFAULT_VERIFICATION_RESULT.kind,
      engineState: ENGINE_STATES.has(engineState)
        ? engineState
        : DEFAULT_VERIFICATION_RESULT.engineState,
      httpStatus: Number.isFinite(Number(src.httpStatus))
        ? Number(src.httpStatus)
        : DEFAULT_VERIFICATION_RESULT.httpStatus,
      message: text(src.message),
      detail: text(src.detail),
      layer: RESPONSE_LAYERS.has(layer)
        ? layer
        : DEFAULT_VERIFICATION_RESULT.layer,
    };
    if (text(src.remediation)) {
      result.remediation = text(src.remediation);
    }
    if (text(src.suggestedCommand)) {
      result.suggestedCommand = text(src.suggestedCommand);
    }
    if (text(src.suggestedUrl)) {
      result.suggestedUrl = text(src.suggestedUrl);
    }
    return result;
  }

  function isAsyncDiscoveryAcceptedResponse(data, status) {
    const httpStatus = Number(status);
    if (!data || typeof data !== "object") return false;
    if (data.ok === true) return false;
    if (httpStatus !== 202 && httpStatus !== 200) return false;
    return !!(
      text(data.status).toLowerCase() === "accepted" ||
      data.accepted === true ||
      text(data.event).toLowerCase() === "command-center.discovery" ||
      Object.prototype.hasOwnProperty.call(data, "delivery_id")
    );
  }

  function isStubOnlyResponse(data) {
    if (!data || typeof data !== "object") return false;
    return !!(
      data.ok === true &&
      (text(data.service) === "command-center-apps-script-stub" ||
        text(data.mode) === "stub" ||
        (data.received === true &&
          data.realDiscoveryConfigured === false &&
          Object.prototype.hasOwnProperty.call(data, "appendedTestRow")) ||
        text(data.kind) === "stub_only")
    );
  }

  function isAccessProtectedResponse(status, textBody, responseUrl) {
    const combined = `${text(responseUrl)}\n${textBody}`.toLowerCase();
    if (
      !/cloudflare access|cloudflareaccess\.com|cdn-cgi\/access\/login|access\.cloudflare/i.test(
        combined,
      )
    ) {
      return false;
    }
    return [200, 302, 401, 403].includes(Number(status));
  }

  function isAppsScriptPrivateResponse(status, textBody) {
    if (Number(status) !== 403) return false;
    const body = text(textBody).toLowerCase();
    return !!(
      body.includes("you need access") ||
      body.includes("open the document directly") ||
      body.includes("script.google.com/macros/edit?lib=") ||
      body.includes("google has not granted")
    );
  }

  function classifyEndpointInput(rawUrl) {
    const url = normalizeUrl(rawUrl);
    if (!url) {
      return createVerificationResult({
        ok: false,
        kind: "invalid_endpoint",
        engineState: "none",
        httpStatus: 0,
        message: "Enter a valid HTTPS URL.",
        detail: "The URL is missing or malformed.",
        layer: "browser",
      });
    }

    if (isLocalOnlyUrl(url)) {
      return createVerificationResult({
        ok: false,
        kind: "invalid_endpoint",
        engineState: "none",
        httpStatus: 0,
        message: "Localhost URLs won't work here.",
        detail: "Use your Worker URL or another public HTTPS endpoint.",
        layer: "browser",
      });
    }

    if (isWorkerForwardPath(url)) {
      return createVerificationResult({
        ok: false,
        kind: "invalid_endpoint",
        engineState: "none",
        httpStatus: 0,
        message: "Use the root Worker URL, not /forward.",
        detail:
          "The /forward path requires auth headers the browser doesn't send.",
        layer: "browser",
      });
    }

    if (isLikelyCloudflareWorkerUrl(url) || isLikelyAppsScriptWebAppUrl(url)) {
      return null;
    }

    if (!/^https:\/\//i.test(url)) {
      return createVerificationResult({
        ok: false,
        kind: "invalid_endpoint",
        engineState: "none",
        httpStatus: 0,
        message: "URL must use HTTPS.",
        detail: "HTTP endpoints won't work — use HTTPS.",
        layer: "browser",
      });
    }

    return null;
  }

  function summarizeResult({
    context,
    status,
    data,
    responseText,
    responseUrl,
    endpointUrl,
  }) {
    const normalizedContext = text(context, "test_webhook");
    const lowerContext = normalizedContext.toLowerCase();
    const isRunContext = lowerContext === "run_discovery";
    const isTestContext = lowerContext !== "run_discovery";
    const endpointLabel = isLikelyAppsScriptWebAppUrl(endpointUrl)
      ? "Apps Script web app"
      : isLikelyCloudflareWorkerUrl(endpointUrl)
        ? "Worker"
        : "endpoint";

    if (isStubOnlyResponse(data)) {
      return createVerificationResult({
        ok: true,
        kind: "stub_only",
        engineState: "stub_only",
        httpStatus: Number(status) || 200,
        message: isTestContext
          ? "Stub connected — wiring works, but no real jobs will be added."
          : "Stub received the request — wiring only.",
        detail: "Switch to a real discovery engine to get Pipeline rows.",
        layer: "upstream",
      });
    }

    if (isAccessProtectedResponse(status, responseText, responseUrl)) {
      return createVerificationResult({
        ok: false,
        kind: "access_protected",
        engineState: "none",
        httpStatus: Number(status) || 403,
        message: "Blocked by Cloudflare Access.",
        detail:
          "Use the open workers.dev URL instead. Cloudflare Access must be off for this route.",
        layer: "browser",
      });
    }

    if (isAppsScriptPrivateResponse(status, responseText)) {
      return createVerificationResult({
        ok: false,
        kind: "apps_script_private",
        engineState: "none",
        httpStatus: Number(status) || 403,
        message: "Apps Script is rejecting anonymous requests.",
        detail: "Redeploy: Execute as → Me, Who has access → Anyone.",
        layer: "upstream",
      });
    }

    if (data && typeof data === "object") {
      if (data.ok === true) {
        return createVerificationResult({
          ok: true,
          kind: "connected_ok",
          engineState: "connected",
          httpStatus: Number(status) || 200,
          message: isTestContext
            ? "Connected — webhook is working."
            : "Discovery started — new rows should appear shortly.",
          detail: "The endpoint returned a success response.",
          layer: "upstream",
        });
      }

      if (isAsyncDiscoveryAcceptedResponse(data, status)) {
        return createVerificationResult({
          ok: true,
          kind: "accepted_async",
          engineState: "unverified",
          httpStatus: Number(status) || 202,
          message: isRunContext
            ? "Discovery accepted — running in the background."
            : "Webhook accepted — request is queued.",
          detail: "Check Pipeline rows shortly for results.",
          layer: "downstream",
        });
      }
    }

    if (!Number(status) || Number(status) < 200 || Number(status) >= 300) {
      if ([502, 503, 504].includes(Number(status))) {
        const workerDownstream = isLikelyCloudflareWorkerUrl(endpointUrl);
        const responseSnippet =
          responseText && responseText.trim()
            ? ` Response: ${responseText.trim().slice(0, 240)}`
            : "";
        const statusCode = Number(status);
        const remediation = workerDownstream
          ? [
              "The relay is reachable but can't connect to your local setup. Check:",
              "1. Is the local server running? Try `hermes gateway run --replace`",
              "2. Is ngrok running? Try `ngrok http <port>`",
              "3. Did the ngrok URL change? Free URLs rotate on restart — redeploy the relay.",
              statusCode === 502
                ? "4. If everything is running, the relay's target URL may be stale. Redeploy with the current ngrok URL."
                : `4. HTTP ${statusCode} — the server may be overloaded. Check server logs.`,
            ].join("\n")
          : "";
        return createVerificationResult({
          ok: false,
          kind: "invalid_endpoint",
          engineState: workerDownstream ? "unverified" : "none",
          httpStatus: statusCode || 0,
          message: workerDownstream
            ? `Relay is up but can't reach your server (${statusCode}).`
            : `${endpointLabel} returned HTTP ${statusCode}.`,
          detail: workerDownstream
            ? `The relay responded, but the service behind it didn't.${responseSnippet}`
            : responseText && responseText.trim()
              ? responseText.trim().slice(0, 500)
              : "Server returned a gateway error.",
          layer: workerDownstream ? "downstream" : "upstream",
          remediation,
        });
      }
      return createVerificationResult({
        ok: false,
        kind: "invalid_endpoint",
        engineState: "none",
        httpStatus: Number(status) || 0,
        message: `${endpointLabel} returned an error.`,
        detail:
          responseText && responseText.trim()
            ? responseText.trim().slice(0, 500)
            : "Unexpected error response.",
        layer: "upstream",
      });
    }

    return createVerificationResult({
      ok: false,
      kind: "invalid_endpoint",
      engineState: "none",
      httpStatus: Number(status) || 200,
      message: `${endpointLabel} responded, but didn't confirm readiness.`,
      detail: "Expected ok: true, an async 202, or a stub-only signal.",
      layer: "upstream",
    });
  }

  async function verifyDiscoveryEndpoint(endpoint, options) {
    const src =
      endpoint && typeof endpoint === "object" ? endpoint : { url: endpoint };
    const endpointUrl = normalizeUrl(src.url);
    const context =
      options && typeof options === "object"
        ? text(options.context, text(src.context, "test_webhook"))
        : text(src.context, "test_webhook");
    const classifiedInput = classifyEndpointInput(endpointUrl);
    if (classifiedInput) {
      return classifiedInput;
    }

    if (typeof fetch !== "function") {
      return createVerificationResult({
        ok: false,
        kind: "network_error",
        engineState: "none",
        httpStatus: 0,
        message: "Fetch is not available in this environment.",
        detail:
          "The verifier needs a browser or Node 18+ runtime with global fetch.",
        layer: "browser",
      });
    }

    const payload =
      options &&
      typeof options === "object" &&
      options.payload &&
      typeof options.payload === "object"
        ? options.payload
        : {
            event: "command-center.discovery",
            schemaVersion: 1,
            sheetId: text(options && options.sheetId),
            requestedAt: new Date().toISOString(),
            variationKey: `verify-${Date.now().toString(36)}`,
          };
    const timeoutMs =
      options &&
      typeof options === "object" &&
      Number.isFinite(Number(options.timeoutMs))
        ? Math.max(1000, Number(options.timeoutMs))
        : 15000;
    const controller =
      typeof AbortController !== "undefined" ? new AbortController() : null;
    const timeoutId = controller
      ? window.setTimeout(() => controller.abort(), timeoutMs)
      : null;

    try {
      const res = await fetch(endpointUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(options &&
          typeof options === "object" &&
          options.headers &&
          typeof options.headers === "object"
            ? options.headers
            : {}),
        },
        body: JSON.stringify(payload),
        signal: controller ? controller.signal : undefined,
        ...(options &&
        typeof options === "object" &&
        options.requestInit &&
        typeof options.requestInit === "object"
          ? options.requestInit
          : {}),
      });

      const responseText = await res.text().catch(() => "");
      let data = null;
      try {
        data = responseText ? JSON.parse(responseText) : null;
      } catch (_) {
        data = null;
      }

      return summarizeResult({
        context,
        status: res.status,
        data,
        responseText,
        responseUrl: res.url || endpointUrl,
        endpointUrl,
      });
    } catch (err) {
      const message = text(err && err.message, text(err, "request failed"));
      return createVerificationResult({
        ok: false,
        kind: "network_error",
        engineState: "none",
        httpStatus: 0,
        message: "Can't reach the endpoint.",
        detail: /cors|failed to fetch|networkerror|typeerror|aborted/i.test(
          message,
        )
          ? "Network or CORS error — check the URL and try again."
          : message,
        layer: "browser",
      });
    } finally {
      if (timeoutId != null) {
        window.clearTimeout(timeoutId);
      }
    }
  }

  Object.assign(verify, {
    createVerificationResult,
    verifyDiscoveryEndpoint,
    classifyEndpointInput,
    summarizeResult,
    isAsyncDiscoveryAcceptedResponse,
    isStubOnlyResponse,
    isAccessProtectedResponse,
    isAppsScriptPrivateResponse,
    normalizeUrl,
  });
})();
