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
    "auth_required",
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

  // Shared URL helpers delegate to the canonical implementation in discovery-shared-helpers.js
  const H = window.JobBoredDiscoveryHelpers || {};

  function text(raw, fallback = "") {
    return typeof H.asString === "function"
      ? H.asString(raw, fallback)
      : (raw == null ? "" : String(raw).trim()) || fallback;
  }

  function normalizeUrl(raw) {
    return typeof H.normalizeUrl === "function"
      ? H.normalizeUrl(raw)
      : (raw == null ? "" : String(raw).trim()) || "";
  }

  function isLikelyAppsScriptWebAppUrl(raw) {
    return typeof H.isLikelyAppsScriptWebAppUrl === "function"
      ? H.isLikelyAppsScriptWebAppUrl(raw)
      : (() => {
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
        })();
  }

  function isLikelyCloudflareWorkerUrl(raw) {
    return typeof H.isLikelyCloudflareWorkerUrl === "function"
      ? H.isLikelyCloudflareWorkerUrl(raw)
      : (() => {
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
        })();
  }

  function isLocalOnlyUrl(raw) {
    return typeof H.isLocalWebhookUrl === "function"
      ? H.isLocalWebhookUrl(raw)
      : (() => {
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
        })();
  }

  function isLocalDashboardOrigin() {
    if (!window || !window.location) return false;
    const host = String(window.location.hostname || "")
      .replace(/^\[|\]$/g, "")
      .toLowerCase();
    if (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "::1"
    ) {
      return true;
    }
    return String(window.location.port || "") === "8080";
  }

  function isWorkerForwardPath(raw) {
    return typeof H.isWorkerForwardUrl === "function"
      ? H.isWorkerForwardUrl(raw)
      : (() => {
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
        })();
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
    if (text(src.runId)) {
      result.runId = text(src.runId);
    }
    if (text(src.statusPath)) {
      result.statusPath = text(src.statusPath);
    }
    if (text(src.status_path)) {
      result.status_path = text(src.status_path);
    }
    if (Number.isFinite(Number(src.pollAfterMs))) {
      result.pollAfterMs = Number(src.pollAfterMs);
    }
    return result;
  }

  function isAsyncDiscoveryAcceptedResponse(data, status) {
    const httpStatus = Number(status);
    if (!data || typeof data !== "object") return false;
    if (httpStatus !== 202 && httpStatus !== 200) return false;
    const hasAcceptedSignal = !!(
      text(data.status).toLowerCase() === "accepted" ||
      text(data.kind).toLowerCase() === "accepted_async" ||
      data.accepted === true ||
      text(data.runId) ||
      text(data.event).toLowerCase() === "command-center.discovery" ||
      Object.prototype.hasOwnProperty.call(data, "delivery_id")
    );
    if (data.ok === true && !hasAcceptedSignal) return false;
    return hasAcceptedSignal;
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

  function isRouteNotFoundResponse(status, data, responseText) {
    if (Number(status) !== 404) return false;
    if (data && typeof data === "object") {
      return (
        data.ok === false && text(data.message).toLowerCase() === "not found"
      );
    }
    return text(responseText).toLowerCase() === "not found";
  }

  function isMissingSheetIdResponse(status, data) {
    if (Number(status) !== 400) return false;
    if (!data || typeof data !== "object") return false;
    return (
      data.ok === false && /sheetid is required\.?/i.test(text(data.message))
    );
  }

  /**
   * The browser-use discovery worker (and any relay that forwards its
   * responses) returns 401 with `{ ok: false, message: "Unauthorized
   * discovery webhook request." }` when the x-discovery-secret header is
   * missing or wrong. We detect this case explicitly so the toast can point
   * the user at the bootstrap autofill instead of a generic "Unauthorized."
   */
  function isAuthRequiredResponse(status, data, responseText) {
    if (Number(status) !== 401) return false;
    if (data && typeof data === "object") {
      const message = text(data.message).toLowerCase();
      if (/unauthorized.*discovery.*webhook.*request/.test(message)) {
        return true;
      }
      if (data.ok === false && message.includes("unauthorized")) {
        return true;
      }
    }
    const body = text(responseText).toLowerCase();
    return body.includes("unauthorized discovery webhook request");
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

    const localOnly = isLocalOnlyUrl(url);
    const localDashboard = isLocalDashboardOrigin();

    if (localOnly && !localDashboard) {
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

    if (!/^https:\/\//i.test(url) && !(localOnly && localDashboard)) {
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
          runId: text(data.runId),
          statusPath: text(data.statusPath),
          pollAfterMs: Number.isFinite(Number(data.pollAfterMs))
            ? Number(data.pollAfterMs)
            : 2000,
        });
      }

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
    }

    if (!Number(status) || Number(status) < 200 || Number(status) >= 300) {
      if (isAuthRequiredResponse(status, data, responseText)) {
        const workerDownstream = isLikelyCloudflareWorkerUrl(endpointUrl);
        return createVerificationResult({
          ok: false,
          kind: "auth_required",
          engineState: "none",
          httpStatus: 401,
          message: workerDownstream
            ? "Relay reached your worker, but the secret was rejected."
            : "The discovery worker needs a webhook secret.",
          detail: workerDownstream
            ? "Your Cloudflare relay forwarded the request, but the upstream worker fail-closed because DISCOVERY_SECRET is missing or wrong."
            : "The browser-use worker fail-closes on empty or mismatched x-discovery-secret. Run `npm run discovery:bootstrap-local` on this machine and reload — the dashboard autofills the secret. Or paste it into Settings → Discovery webhook secret.",
          layer: workerDownstream ? "downstream" : "upstream",
          remediation: workerDownstream
            ? [
                "Refresh the relay's downstream secret:",
                "1. Run `npm run discovery:bootstrap-local` to (re)generate the worker secret in `integrations/browser-use-discovery/.env`.",
                '2. Redeploy with `npm run cloudflare-relay:deploy -- --target-url <ngrok URL> --discovery-secret "$(grep BROWSER_USE_DISCOVERY_WEBHOOK_SECRET integrations/browser-use-discovery/.env | cut -d= -f2)"`.',
                "3. Click Test webhook again.",
              ].join("\n")
            : [
                "1. Run `npm run discovery:bootstrap-local` on this machine.",
                "2. Reload the dashboard — the secret will autofill.",
                "3. Click Test webhook (or Run discovery) again.",
              ].join("\n"),
          suggestedCommand: "npm run discovery:bootstrap-local",
        });
      }
      if (isRouteNotFoundResponse(status, data, responseText)) {
        const workerDownstream = isLikelyCloudflareWorkerUrl(endpointUrl);
        return createVerificationResult({
          ok: false,
          kind: "invalid_endpoint",
          engineState: workerDownstream ? "unverified" : "none",
          httpStatus: 404,
          message: workerDownstream
            ? "Relay reached your server, but the webhook path does not exist."
            : `${endpointLabel} path was not found.`,
          detail: workerDownstream
            ? "The Worker is up, but its downstream target points at a missing route. This usually means the hidden local target behind the Worker is stale, not that the saved Worker URL itself is wrong."
            : "The URL path returned 404 Not found. Check the exact webhook path.",
          layer: workerDownstream ? "downstream" : "upstream",
          remediation: workerDownstream
            ? [
                "Layman's version: JobBored can still reach your Cloudflare Worker, but the Worker is forwarding to an old local path.",
                "1. Re-run `npm run discovery:bootstrap-local` so the local webhook resolves to `/webhook`.",
                "2. Confirm the live public target ends in `/webhook`, not `/webhooks/command-center-discovery-*`.",
                "3. Redeploy the Cloudflare relay so TARGET_URL uses that refreshed public target.",
                "4. Keep the same open Worker URL saved in JobBored.",
                "5. Run Test connection again.",
              ].join("\n")
            : "",
        });
      }

      if (isMissingSheetIdResponse(status, data)) {
        const workerDownstream = isLikelyCloudflareWorkerUrl(endpointUrl);
        return createVerificationResult({
          ok: false,
          kind: "invalid_endpoint",
          engineState: workerDownstream ? "unverified" : "none",
          httpStatus: 400,
          message: workerDownstream
            ? "Relay reached your server, but no Sheet ID was provided."
            : "Sheet ID is required.",
          detail: workerDownstream
            ? "The Worker forwarded the request successfully. The discovery server rejected it because the request payload did not include `sheetId`."
            : "This endpoint expects a `sheetId` field in the request payload.",
          layer: workerDownstream ? "downstream" : "upstream",
          remediation: workerDownstream
            ? [
                "Add the Google Sheet ID before testing again:",
                "1. Open Settings and paste the destination Google Sheet ID into the discovery / sheet field.",
                "2. Save the settings.",
                "3. Run Test connection again.",
              ].join("\n")
            : "",
        });
      }

      if (data && typeof data === "object" && data.ok === false) {
        const workerDownstream = isLikelyCloudflareWorkerUrl(endpointUrl);
        const responseMessage =
          text(data.message) ||
          `${endpointLabel} returned HTTP ${Number(status) || 0}.`;
        const responseDetail =
          text(data.detail) ||
          (responseText && responseText.trim()
            ? responseText.trim().slice(0, 500)
            : "Unexpected error response.");
        const remediation = text(data.remediation);
        return createVerificationResult({
          ok: false,
          kind: "invalid_endpoint",
          engineState: workerDownstream ? "unverified" : "none",
          httpStatus: Number(status) || 0,
          message: responseMessage,
          detail:
            responseDetail && responseDetail !== responseMessage
              ? responseDetail
              : "",
          layer: workerDownstream ? "downstream" : "upstream",
          ...(remediation ? { remediation } : {}),
        });
      }
      if ([502, 503, 504].includes(Number(status))) {
        const workerDownstream = isLikelyCloudflareWorkerUrl(endpointUrl);
        const responseSnippet =
          responseText && responseText.trim()
            ? ` Response: ${responseText.trim().slice(0, 240)}`
            : "";
        const statusCode = Number(status);
        const remediation = workerDownstream
          ? [
              "Layman's version: JobBored can still reach your Cloudflare Worker, but the Worker cannot reach the local tunnel behind it.",
              "1. Keep the same open Worker URL saved in JobBored.",
              "2. Is the local server running? Try `hermes gateway run --replace`.",
              "3. Is ngrok running? Try `ngrok http <port>`.",
              "4. If ngrok shows a new URL, redeploy the Cloudflare relay so TARGET_URL uses the new ngrok `/webhook` URL.",
              statusCode === 502
                ? "5. Run Test connection again after the relay redeploy finishes."
                : `5. HTTP ${statusCode} can also mean the local server is overloaded. Check server logs, then test again.`,
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

    const secret =
      options &&
      typeof options === "object" &&
      typeof options.secret === "string"
        ? options.secret.trim()
        : "";
    try {
      const res = await fetch(endpointUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(secret ? { "x-discovery-secret": secret } : {}),
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
      const isCorsLike =
        /cors|failed to fetch|networkerror|typeerror|aborted/i.test(message);
      // Always include the URL we tried so users (and us) can see *what*
      // failed without having to crack open DevTools. The previous "Network
      // or CORS error — check the URL" was uselessly vague.
      const detailParts = [];
      if (isCorsLike) {
        detailParts.push(
          "The browser couldn't establish a connection. Likely causes: the URL is offline (DNS/host not resolving), the receiver isn't running, or CORS is blocking the preflight.",
        );
      } else {
        detailParts.push(message);
      }
      detailParts.push(`Tried: ${endpointUrl}`);
      return createVerificationResult({
        ok: false,
        kind: "network_error",
        engineState: "none",
        httpStatus: 0,
        message: "Can't reach the endpoint.",
        detail: detailParts.join(" — "),
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
