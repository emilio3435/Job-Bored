/* ============================================
   COMMAND CENTER v2 — Apps Script / Relay Helpers
   Extracted from app.js (apps-script-relay-helpers cut).

   Classic-global IIFE under window.JobBoredDiscovery.relayHelpers — NOT an ES module.
   Loaded BEFORE app.js (after app-config-core.js). Pure URL/classification,
   relay deploy command builders, Apps Script access labels, and discovery
   success-toast builders. Settings/webhook deps read via lazy relayHelpers.host.
   ============================================ */
(() => {
  const root = window.JobBoredDiscovery || (window.JobBoredDiscovery = {});
  const relayHelpers = root.relayHelpers || (root.relayHelpers = {});

  const configCore = window.JobBoredApp.configCore;
  const APPS_SCRIPT_WEBAPP_ACCESS = configCore.APPS_SCRIPT_WEBAPP_ACCESS;
  const APPS_SCRIPT_WEBAPP_EXECUTE_AS = configCore.APPS_SCRIPT_WEBAPP_EXECUTE_AS;

  function host() {
    return relayHelpers.host || {};
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

    if (deploymentAccess && deploymentAccess !== APPS_SCRIPT_WEBAPP_ACCESS) {
      detail = `Google has “Who has access” set to ${accessLabel}, not “Anyone.” Change it in Deploy → Manage deployments.`;
    } else if (
      deploymentExecuteAs &&
      deploymentExecuteAs !== APPS_SCRIPT_WEBAPP_EXECUTE_AS
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

  function isLikelyAppsScriptWebAppUrl(raw) {
    const s = raw != null ? String(raw).trim() : "";
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
    const s = raw != null ? String(raw).trim() : "";
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

  function buildCloudflareRelayCorsSnippet(origin) {
    const value =
      origin && origin !== "*" ? origin : "https://your-static-site.example";
    return `[vars]\nCORS_ORIGIN = "${value.replace(/"/g, '\\"')}"`;
  }

  function sanitizeCloudflareWorkerName(raw) {
    const s = String(raw || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/-{2,}/g, "-")
      .replace(/^-+|-+$/g, "");
    return s.slice(0, 63).replace(/^-+|-+$/g, "");
  }

  function inferCloudflareRelaySuffixFromTarget(targetUrl) {
    const url = String(targetUrl || "").trim();
    if (!url) return "";
    try {
      const parsed = new URL(url);
      const scriptIdMatch = parsed.pathname.match(/\/macros\/s\/([^/]+)/i);
      if (scriptIdMatch && scriptIdMatch[1]) {
        return scriptIdMatch[1].slice(-6).toLowerCase();
      }
      return parsed.hostname.replace(/[^a-z0-9]+/gi, "-").slice(0, 10);
    } catch (_) {
      return "";
    }
  }

  function getSuggestedCloudflareRelayWorkerName(targetUrl) {
    const suffix =
      inferCloudflareRelaySuffixFromTarget(targetUrl) ||
      String(
        (typeof host().getSettingsSheetIdValue === "function"
          ? host().getSettingsSheetIdValue()
          : "") || "",
      )
        .slice(-6)
        .toLowerCase() ||
      "main";
    return (
      sanitizeCloudflareWorkerName(`jobbored-discovery-relay-${suffix}`) ||
      "jobbored-discovery-relay"
    );
  }

  /** First label of *.workers.dev hostname, e.g. jobbored-discovery-relay-abc123. */
  function inferCloudflareWorkerNameFromOpenWorkerUrl(raw) {
    const s = String(raw || "").trim();
    if (!s) return "";
    try {
      const u = new URL(s);
      if (!/\.workers\.dev$/i.test(u.hostname)) return "";
      const first = u.hostname.split(".")[0];
      return sanitizeCloudflareWorkerName(first);
    } catch (_) {
      return "";
    }
  }

  function quoteShellArg(raw) {
    return `'${String(raw || "").replace(/'/g, `'\"'\"'`)}'`;
  }

  function buildCloudflareRelayDeployCommand(
    targetUrl,
    origin,
    workerName,
    sheetId,
  ) {
    const parts = ["npm run cloudflare-relay:deploy --"];
    if (targetUrl) {
      parts.push(`--target-url ${quoteShellArg(targetUrl)}`);
    }
    if (origin && origin !== "*") {
      parts.push(`--cors-origin ${quoteShellArg(origin)}`);
    }
    if (workerName) {
      parts.push(`--worker-name ${quoteShellArg(workerName)}`);
    }
    if (sheetId) {
      parts.push(`--sheet-id ${quoteShellArg(sheetId)}`);
    }
    return parts.join(" ");
  }

  function getDiscoveryRelaySuggestedOrigin() {
    return typeof window !== "undefined" &&
      window.location &&
      typeof window.location.origin === "string" &&
      /^https?:\/\//i.test(window.location.origin)
      ? window.location.origin.trim()
      : "";
  }

  function getDiscoveryRelayWorkerName(targetUrl, preferredWorkerUrl = "") {
    const normalize =
      typeof host().normalizeDiscoveryWebhookIdentity === "function"
        ? host().normalizeDiscoveryWebhookIdentity.bind(host())
        : (raw) => (raw == null ? "" : String(raw).trim());
    const currentWorkerUrl =
      normalize(preferredWorkerUrl) ||
      normalize(
        typeof host().getSettingsFieldValue === "function"
          ? host().getSettingsFieldValue("settingsDiscoveryWebhookUrl").trim()
          : "",
      ) ||
      normalize(
        typeof host().getDiscoveryWebhookUrl === "function"
          ? host().getDiscoveryWebhookUrl()
          : "",
      );
    const explicitWorker =
      inferCloudflareWorkerNameFromOpenWorkerUrl(currentWorkerUrl);
    return explicitWorker || getSuggestedCloudflareRelayWorkerName(targetUrl);
  }

  function buildDiscoveryRelayDeployCommandForTarget(targetUrl, options = {}) {
    const normalize =
      typeof host().normalizeDiscoveryWebhookIdentity === "function"
        ? host().normalizeDiscoveryWebhookIdentity.bind(host())
        : (raw) => (raw == null ? "" : String(raw).trim());
    const normalizedTargetUrl = normalize(targetUrl);
    if (!normalizedTargetUrl) return "";
    const explicitWorkerName = sanitizeCloudflareWorkerName(options.workerName);
    const workerName =
      explicitWorkerName ||
      getDiscoveryRelayWorkerName(
        normalizedTargetUrl,
        String(options.workerUrl || ""),
      );
    const sheetId =
      String(options.sheetId || "").trim() ||
      (typeof host().getSettingsSheetIdValue === "function"
        ? host().getSettingsSheetIdValue()
        : "") ||
      "";
    return buildCloudflareRelayDeployCommand(
      normalizedTargetUrl,
      String(options.origin || "").trim() || getDiscoveryRelaySuggestedOrigin(),
      workerName,
      sheetId,
    );
  }

  function createDiscoveryRelayCopyCommandToastAction(command) {
    const text = String(command || "").trim();
    if (!text) return null;
    return {
      label: "Copy command",
      onClick() {
        if (typeof host().copyTextToClipboard === "function") {
          host().copyTextToClipboard(text);
        }
      },
    };
  }

  function buildCloudflareRelayAgentPrompt(
    targetUrl,
    origin,
    workerName,
    sheetId,
  ) {
    if (!targetUrl) {
      return `We’re in the Job-Bored repo.\n\nStop: no Apps Script /exec URL is configured yet, so there is no downstream TARGET_URL for the Cloudflare relay.\n\nAsk the user to finish Apps Script deploy first, then rerun relay setup.`;
    }
    const deployCommand = buildCloudflareRelayDeployCommand(
      targetUrl,
      origin,
      workerName,
      sheetId,
    );
    const verifyLine = sheetId
      ? "5. Because the command includes `--sheet-id`, the helper should also run the webhook verification step automatically after deploy."
      : "5. After it succeeds, tell me to paste the Worker URL into Discovery drawer -> Connection -> Discovery webhook URL and run Test webhook.";
    return `We’re in the Job-Bored repo. Set up the Cloudflare Worker relay for Command Center discovery.\n\nCurrent values:\n- TARGET_URL: ${targetUrl}\n- CORS_ORIGIN: ${origin || "*"}\n- Suggested worker name: ${workerName}\n\nDo this:\n1. Run this command from the repo root:\n   ${deployCommand}\n2. If Cloudflare auth is missing, let the helper script open \`wrangler login\` automatically. If that still cannot work, then tell me exactly whether you need \`npx wrangler login\` manually or \`CLOUDFLARE_API_TOKEN\` + \`CLOUDFLARE_ACCOUNT_ID\`.\n3. Return the deployed \`workers.dev\` URL only.\n4. Do not use \`/forward\` or \`FORWARD_SECRET\` for this dashboard path, and keep Cloudflare Access disabled on the open \`workers.dev\` URL.\n${verifyLine}\n\nIf the script stops at a one-time \`workers.dev\` subdomain prompt, tell me which path applies:\n- browser-login path: I should answer the prompt once in the terminal\n- API-token path: rerun with \`CLOUDFLARE_API_TOKEN\`; the helper can then reuse or create the account subdomain automatically.`;
  }

  function describeCloudflareAccessProtectedWebhook(status, text, responseUrl) {
    const body = String(text || "");
    const url = String(responseUrl || "");
    const combined = `${url}\n${body}`;
    if (
      !/cloudflare access|cloudflareaccess\.com|cdn-cgi\/access\/login|access\.cloudflare/i.test(
        combined,
      )
    ) {
      return "";
    }
    if (
      Number(status) !== 200 &&
      Number(status) !== 302 &&
      Number(status) !== 401 &&
      Number(status) !== 403
    ) {
      return "";
    }
    return "This Worker URL is protected by Cloudflare Access. Disable Cloudflare Access for the open workers.dev URL, then test again.";
  }

  function describeAppsScriptHtmlAccessIssue(status, text) {
    const body = String(text || "");
    if (Number(status) !== 403) return "";
    if (
      !/you need access/i.test(body) &&
      !/open the document directly/i.test(body) &&
      !/script\.google\.com\/macros\/edit\?lib=/i.test(body)
    ) {
      return "";
    }
    return 'Google is rejecting anonymous access to the Apps Script web app. Open the Apps Script deployment and confirm Execute as is "Me" and Who has access is "Anyone", then re-check public access.';
  }

  function isAppsScriptWebhookStubResponse(data) {
    return !!(
      data &&
      typeof data === "object" &&
      data.ok === true &&
      (data.service === "command-center-apps-script-stub" ||
        data.mode === "stub" ||
        (data.received === true &&
          data.realDiscoveryConfigured === false &&
          Object.prototype.hasOwnProperty.call(data, "appendedTestRow")))
    );
  }

  function isAsyncDiscoveryAcceptedResponse(data, status) {
    const httpStatus = Number(status);
    if (!data || typeof data !== "object") return false;
    if (data.ok === true) return false;
    if (httpStatus !== 202 && httpStatus !== 200) return false;
    return !!(
      String(data.status || "").toLowerCase() === "accepted" ||
      data.accepted === true ||
      String(data.event || "").toLowerCase() === "command-center.discovery" ||
      Object.prototype.hasOwnProperty.call(data, "delivery_id")
    );
  }

  function buildDiscoverySuccessToast(data, options) {
    const o = options && typeof options === "object" ? options : {};
    const isTest = !!o.isTest;
    const acceptedAsync = isAsyncDiscoveryAcceptedResponse(data, o.status);
    if (isAppsScriptWebhookStubResponse(data)) {
      if (data.appendedTestRow === true) {
        return {
          type: "info",
          persistent: true,
          message: isTest
            ? "Stub OK — appended a [CC test] row. This confirms webhook wiring only; it does not find real jobs."
            : "Stub received the request and appended a [CC test] row. This confirms webhook wiring only; no real job discovery is configured yet.",
        };
      }
      return {
        type: "info",
        persistent: true,
        message: isTest
          ? "Stub OK — endpoint is wired, but it will not add jobs. Set ENABLE_TEST_ROW=true for a smoke test, or replace the stub with real discovery logic."
          : "The current endpoint is the Apps Script stub. It accepted the request, but it does not add real job leads. Set ENABLE_TEST_ROW=true for a smoke test, or replace the stub with real discovery logic.",
      };
    }
    if (acceptedAsync) {
      return {
        type: "success",
        persistent: false,
        message: isTest
          ? "Webhook accepted — your automation queued the run"
          : "Discovery accepted — your automation queued the run",
      };
    }
    return {
      type: "success",
      persistent: false,
      message: isTest
        ? "Webhook OK — endpoint returned ok: true"
        : "Discovery started — new roles will appear in your sheet when your agent finishes",
    };
  }

  Object.assign(relayHelpers, {
    getAppsScriptEditorUrl,
    formatAppsScriptWebAppAccessLabel,
    formatAppsScriptExecuteAsLabel,
    buildAppsScriptPublicAccessRemediationStatus,
    isLikelyAppsScriptWebAppUrl,
    isLikelyCloudflareWorkerUrl,
    buildCloudflareRelayCorsSnippet,
    sanitizeCloudflareWorkerName,
    inferCloudflareRelaySuffixFromTarget,
    getSuggestedCloudflareRelayWorkerName,
    inferCloudflareWorkerNameFromOpenWorkerUrl,
    quoteShellArg,
    buildCloudflareRelayDeployCommand,
    getDiscoveryRelaySuggestedOrigin,
    getDiscoveryRelayWorkerName,
    buildDiscoveryRelayDeployCommandForTarget,
    createDiscoveryRelayCopyCommandToastAction,
    buildCloudflareRelayAgentPrompt,
    describeCloudflareAccessProtectedWebhook,
    describeAppsScriptHtmlAccessIssue,
    isAppsScriptWebhookStubResponse,
    isAsyncDiscoveryAcceptedResponse,
    buildDiscoverySuccessToast,
  });
})();
