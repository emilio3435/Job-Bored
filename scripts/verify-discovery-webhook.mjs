#!/usr/bin/env node
/**
 * Smoke-test a discovery webhook URL (POST body matches AGENT_CONTRACT + examples).
 * Use after Apps Script deploy, relay setup, or any HTTPS receiver to confirm the endpoint works.
 *
 * Usage:
 *   npm run test:discovery-webhook -- --url "https://…/exec" --sheet-id YOUR_SHEET_ID
 *
 * Env (optional): DISCOVERY_WEBHOOK_URL, SHEET_ID
 *
 * Requires Node 18+ (global fetch).
 */
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const root = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(root, "..");

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

function parseArgs(argv) {
  const out = {
    url: null,
    sheetId: null,
    retries: null,
    retryDelayMs: null,
    context: null,
    json: false,
  };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--url" && argv[i + 1]) {
      out.url = argv[++i];
      continue;
    }
    if (argv[i] === "--sheet-id" && argv[i + 1]) {
      out.sheetId = argv[++i];
      continue;
    }
    if (argv[i] === "--retries" && argv[i + 1]) {
      out.retries = argv[++i];
      continue;
    }
    if (argv[i] === "--retry-delay-ms" && argv[i + 1]) {
      out.retryDelayMs = argv[++i];
      continue;
    }
    if (argv[i] === "--context" && argv[i + 1]) {
      out.context = argv[++i];
      continue;
    }
    if (argv[i] === "--json") {
      out.json = true;
    }
  }
  out.url = out.url || process.env.DISCOVERY_WEBHOOK_URL || "";
  out.sheetId = out.sheetId || process.env.SHEET_ID || "";
  out.retries =
    out.retries ?? process.env.DISCOVERY_WEBHOOK_VERIFY_RETRIES ?? "6";
  out.retryDelayMs =
    out.retryDelayMs ??
    process.env.DISCOVERY_WEBHOOK_VERIFY_RETRY_DELAY_MS ??
    "5000";
  out.context = out.context || process.env.DISCOVERY_WEBHOOK_VERIFY_CONTEXT || "test_webhook";
  return out;
}

function parsePositiveInt(raw, flagName) {
  const value = Number.parseInt(String(raw), 10);
  if (!Number.isFinite(value) || value < 0) {
    console.error(
      `verify-discovery-webhook: ${flagName} must be a non-negative integer.`,
    );
    process.exit(1);
  }
  return value;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
  const kind = text(src.kind, "invalid_endpoint");
  const engineState = text(src.engineState, "none");
  return {
    ok: !!src.ok,
    kind: RESULT_KINDS.has(kind) ? kind : "invalid_endpoint",
    engineState: ENGINE_STATES.has(engineState) ? engineState : "none",
    httpStatus: Number.isFinite(Number(src.httpStatus))
      ? Number(src.httpStatus)
      : 0,
    message: text(src.message),
    detail: text(src.detail),
    layer: text(src.layer, "browser"),
  };
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
      message: "Paste a valid HTTPS discovery webhook URL.",
      detail: "The endpoint is missing or malformed.",
      layer: "browser",
    });
  }

  if (isLocalOnlyUrl(url)) {
    return createVerificationResult({
      ok: false,
      kind: "invalid_endpoint",
      message: "Local-only URLs are not valid discovery endpoints here.",
      detail:
        "Use the browser-facing Worker URL or another public HTTPS endpoint instead of localhost.",
      layer: "browser",
    });
  }

  if (isWorkerForwardPath(url)) {
    return createVerificationResult({
      ok: false,
      kind: "invalid_endpoint",
      message: "Use the open Worker URL, not /forward.",
      detail:
        "The dashboard does not send custom auth headers, so the locked relay path cannot be the browser endpoint.",
      layer: "browser",
    });
  }

  if (!/^https:\/\//i.test(url)) {
    return createVerificationResult({
      ok: false,
      kind: "invalid_endpoint",
      message: "Discovery webhook URLs must use HTTPS.",
      detail: "The browser flow expects a public HTTPS endpoint.",
      layer: "browser",
    });
  }

  return null;
}

function summarizeResult({ context, status, data, responseText, responseUrl, endpointUrl }) {
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
        ? "Stub OK - endpoint is wired, but it will not add jobs."
        : "Stub received the request, but it is still wiring only.",
      detail:
        "This confirms webhook wiring only. Connect a real discovery engine before expecting Pipeline rows.",
      layer: "upstream",
    });
  }

  if (isAccessProtectedResponse(status, responseText, responseUrl)) {
    return createVerificationResult({
      ok: false,
      kind: "access_protected",
      message: "Cloudflare Access is protecting this Worker URL.",
      detail:
        "Use the open workers.dev URL for browser verification and keep Cloudflare Access off that route.",
      layer: "browser",
    });
  }

  if (isAppsScriptPrivateResponse(status, responseText)) {
    return createVerificationResult({
      ok: false,
      kind: "apps_script_private",
      message: "Google is rejecting anonymous access to the Apps Script web app.",
      detail:
        'Redeploy the web app as Execute as: Me and Who has access: Anyone, then re-check public access.',
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
          ? "Webhook OK - endpoint returned ok: true"
          : "Discovery started - new rows should appear when the automation finishes.",
        detail:
          "The endpoint returned a direct success response and is ready for browser use.",
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
          ? "Discovery accepted - your automation queued the run"
          : "Webhook accepted - your automation queued the run",
        detail:
          "The receiver accepted the request asynchronously. Check your automation logs or Pipeline rows next.",
        layer: "downstream",
      });
    }
  }

  if (!Number(status) || Number(status) < 200 || Number(status) >= 300) {
    return createVerificationResult({
      ok: false,
      kind: "invalid_endpoint",
      httpStatus: Number(status) || 0,
      message: `The ${endpointLabel} did not return a valid success response.`,
      detail:
        responseText && responseText.trim()
          ? responseText.trim().slice(0, 500)
          : "The endpoint responded with an error or an unexpected payload.",
      layer: "upstream",
    });
  }

  return createVerificationResult({
    ok: false,
    kind: "invalid_endpoint",
    httpStatus: Number(status) || 200,
    message: `The ${endpointLabel} responded, but it did not confirm discovery readiness.`,
    detail:
      "Expected ok: true, an accepted async response, or a known stub-only signal.",
    layer: "upstream",
  });
}

async function verifyDiscoveryEndpoint(endpoint, options) {
  const src = endpoint && typeof endpoint === "object" ? endpoint : { url: endpoint };
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
      message: "Fetch is not available in this environment.",
      detail:
        "The verifier needs a browser or Node 18+ runtime with global fetch.",
      layer: "browser",
    });
  }

  const payload =
    options && typeof options === "object" && options.payload && typeof options.payload === "object"
      ? options.payload
      : {
          event: "command-center.discovery",
          schemaVersion: 1,
          sheetId: text(options && options.sheetId),
          requestedAt: new Date().toISOString(),
          variationKey: `verify-${Date.now().toString(36)}`,
        };
  const timeoutMs =
    options && typeof options === "object" && Number.isFinite(Number(options.timeoutMs))
      ? Math.max(1000, Number(options.timeoutMs))
      : 15000;
  const controller =
    typeof AbortController !== "undefined" ? new AbortController() : null;
  const timeoutId = controller
    ? setTimeout(() => controller.abort(), timeoutMs)
    : null;
  const requestInit =
    options && typeof options === "object" && options.requestInit && typeof options.requestInit === "object"
      ? options.requestInit
      : {};

  try {
    const res = await fetch(endpointUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(options && typeof options === "object" && options.headers && typeof options.headers === "object"
          ? options.headers
          : {}),
      },
      body: JSON.stringify(payload),
      signal: controller ? controller.signal : undefined,
      ...requestInit,
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
      message: "Could not reach the discovery endpoint.",
      detail: /cors|failed to fetch|networkerror|typeerror|aborted/i.test(message)
        ? "The browser likely hit a network or CORS failure."
        : message,
      layer: "browser",
    });
  } finally {
    if (timeoutId != null) {
      clearTimeout(timeoutId);
    }
  }
}

function printUsage(code = 0) {
  const out = code === 0 ? console.log : console.error;
  out(`verify-discovery-webhook

Usage:
  npm run test:discovery-webhook -- --url "https://…/exec" --sheet-id YOUR_SHEET_ID
  npm run test:discovery-webhook -- --url "https://…/exec" --context run_discovery

Options:
  --url               Required HTTPS webhook URL.
  --sheet-id          Optional Sheet ID or URL. Used in the default payload.
  --retries           Number of retry attempts for retryable failures. Default: 6.
  --retry-delay-ms    Base retry delay in milliseconds. Default: 5000.
  --context           Message context: test_webhook or run_discovery.
  --json              Print the structured verificationResult JSON on success or failure.
  --help              Show this message.

Env (optional):
  DISCOVERY_WEBHOOK_URL, SHEET_ID, DISCOVERY_WEBHOOK_VERIFY_RETRIES,
  DISCOVERY_WEBHOOK_VERIFY_RETRY_DELAY_MS, DISCOVERY_WEBHOOK_VERIFY_CONTEXT
`);
  process.exit(code);
}

function classifyRetryable(result) {
  if (!result || typeof result !== "object") return false;
  if (result.ok) return false;
  if (result.kind === "network_error") return true;
  if (Number(result.httpStatus) >= 500) return true;
  return false;
}

function logResult(result, context) {
  const prefix =
    context && String(context).toLowerCase() === "run_discovery"
      ? "verify-discovery-webhook"
      : "verify-discovery-webhook";
  if (result.ok) {
    if (result.kind === "stub_only") {
      console.log(`${prefix}: OK - endpoint is the Apps Script stub (wiring only).`);
      console.log("  Tip: this confirms webhook wiring, not real discovery readiness.");
      return;
    }
    if (result.kind === "accepted_async") {
      console.log(
        `${prefix}: OK - endpoint accepted the run asynchronously (HTTP ${result.httpStatus})`,
      );
      console.log(
        "  Tip: this receiver queued work instead of returning ok: true. Check your automation logs or Pipeline rows next.",
      );
      return;
    }
    if (context && String(context).toLowerCase() === "run_discovery") {
      console.log(
        `${prefix}: OK - discovery started (HTTP ${result.httpStatus})`,
      );
      console.log(
        "  Tip: confirm the downstream automation writes real Pipeline rows before treating this as connected.",
      );
      return;
    }
    console.log(`${prefix}: OK - endpoint returned ok: true (HTTP ${result.httpStatus})`);
    console.log(
      "  Tip: confirm a real discovery engine is writing Pipeline rows before treating this as connected.",
    );
    return;
  }

  console.error(`${prefix}: request failed: ${result.message || "unknown error"}`);
  if (result.detail) {
    console.error(`  ${result.detail}`);
  }
}

async function main() {
  const major = Number(process.versions.node.split(".")[0]);
  if (Number.isNaN(major) || major < 18) {
    console.error(
      "verify-discovery-webhook: Node 18+ required (uses global fetch).",
    );
    process.exit(1);
  }

  const { url, sheetId, retries, retryDelayMs, context, json } = parseArgs(process.argv);
  if (!url || !String(url).trim()) {
    printUsage(1);
  }

  const maxRetries = parsePositiveInt(retries, "--retries");
  const baseRetryDelayMs = parsePositiveInt(retryDelayMs, "--retry-delay-ms");

  const u = normalizeUrl(url);
  if (!u) {
    console.error("verify-discovery-webhook: --url must be a valid HTTPS URL.");
    process.exit(1);
  }
  if (!/^https:\/\//i.test(u)) {
    console.error("verify-discovery-webhook: --url must start with https://");
    process.exit(1);
  }

  const inputClassification = classifyEndpointInput(u);
  if (inputClassification) {
    if (json) {
      console.log(JSON.stringify(inputClassification, null, 2));
    } else {
      logResult(inputClassification, context);
    }
    process.exit(inputClassification.ok ? 0 : 1);
  }

  const templatePath = join(
    repoRoot,
    "examples",
    "discovery-webhook-request.v1.json",
  );
  let body;
  try {
    body = JSON.parse(readFileSync(templatePath, "utf8"));
  } catch (e) {
    console.error("verify-discovery-webhook: could not read example JSON:", e);
    process.exit(1);
  }

  if (sheetId && String(sheetId).trim()) {
    body.sheetId = String(sheetId).trim();
  } else {
    console.warn(
      "verify-discovery-webhook: no --sheet-id / SHEET_ID — using example sheetId (Apps Script SHEET_ID check may fail).",
    );
  }

  body.variationKey = `verify-${Date.now().toString(36)}`;
  body.requestedAt = new Date().toISOString();

  const runOnce = async () => {
    const result = await verifyDiscoveryEndpoint(u, {
      payload: body,
      sheetId,
      context,
      timeoutMs: 15000,
    });
    return result;
  };

  let lastError = null;
  for (let attempt = 1; attempt <= maxRetries + 1; attempt += 1) {
    try {
      const result = await runOnce();
      if (json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        logResult(result, context);
      }
      if (result.ok || !classifyRetryable(result) || attempt > maxRetries) {
        process.exit(result.ok ? 0 : 1);
      }
      lastError = result;
    } catch (err) {
      lastError = err;
      const message = err && err.message ? err.message : String(err || "unknown error");
      const retryable = /fetch failed|ENOTFOUND|ECONNRESET|timed out|aborted/i.test(message);
      if (!retryable || attempt > maxRetries) {
        break;
      }
      const waitMs = baseRetryDelayMs * attempt;
      console.warn(
        `verify-discovery-webhook: attempt ${attempt} failed: ${message}`,
      );
      console.warn(
        `verify-discovery-webhook: waiting ${Math.round(waitMs / 1000)}s before retrying...`,
      );
      await sleep(waitMs);
    }
  }

  const message =
    lastError && typeof lastError === "object" && "message" in lastError
      ? lastError.message
      : String(lastError || "unknown error");
  console.error("verify-discovery-webhook: request failed:", message);
  if (/fetch failed|ENOTFOUND|ECONNRESET|timed out/i.test(String(message))) {
    console.error(
      "verify-discovery-webhook: this is usually workers.dev DNS/propagation immediately after first deploy. Wait a minute and retry.",
    );
  }
  process.exit(1);
}

main().catch((err) => {
  console.error("verify-discovery-webhook: request failed:", err.message || err);
  process.exit(1);
});
