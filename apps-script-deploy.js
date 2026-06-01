/* ============================================
   COMMAND CENTER v2 — Apps Script Deploy UI
   Extracted from app.js (apps-script-deploy cut).

   Classic-global IIFE under window.JobBoredDiscovery.appsScriptDeploy — NOT an ES module.
   Loaded BEFORE app.js (after discovery-status-handoff.js and apps-script-relay-helpers.js).
   Deploy token flow, stub upload, public-access probe, and settings deploy UI.
   ============================================ */
(() => {
  const root = window.JobBoredDiscovery || (window.JobBoredDiscovery = {});
  const appsScriptDeploy = root.appsScriptDeploy || (root.appsScriptDeploy = {});

  const configCore = window.JobBoredApp.configCore;
  const APPS_SCRIPT_API_BASE = configCore.APPS_SCRIPT_API_BASE;
  const APPS_SCRIPT_DEPLOY_SCOPES = configCore.APPS_SCRIPT_DEPLOY_SCOPES;
  const APPS_SCRIPT_MANAGED_BY = configCore.APPS_SCRIPT_MANAGED_BY;
  const APPS_SCRIPT_PROJECT_TITLE = configCore.APPS_SCRIPT_PROJECT_TITLE;
  const APPS_SCRIPT_WEBAPP_ACCESS = configCore.APPS_SCRIPT_WEBAPP_ACCESS;
  const APPS_SCRIPT_WEBAPP_EXECUTE_AS = configCore.APPS_SCRIPT_WEBAPP_EXECUTE_AS;
  const APPS_SCRIPT_PUBLIC_ACCESS_READY = configCore.APPS_SCRIPT_PUBLIC_ACCESS_READY;
  const APPS_SCRIPT_PUBLIC_ACCESS_NEEDS_REMEDIATION =
    configCore.APPS_SCRIPT_PUBLIC_ACCESS_NEEDS_REMEDIATION;
  const DISCOVERY_ENGINE_STATE_STUB_ONLY = configCore.DISCOVERY_ENGINE_STATE_STUB_ONLY;
  const GIS_INIT_STUCK_MS = configCore.GIS_INIT_STUCK_MS;

  const relayHelpers = window.JobBoredDiscovery.relayHelpers;
  const statusApi = window.JobBoredDiscovery.status;

  function host() {
    return appsScriptDeploy.host || {};
  }

  function h(name, ...args) {
    const fn = host()[name];
    return typeof fn === "function" ? fn(...args) : undefined;
  }

function getWindowOriginLabel() {
  try {
    return window.location.origin || "";
  } catch (_) {
    return "";
  }
}

function buildAppsScriptGisNotReadyStatus(clientId) {
  const currentOrigin = getWindowOriginLabel();
  const needsReload = h("hasUnsavedOAuthClientIdChange", clientId);
  if (needsReload) {
    return {
      tone: "warning",
      message:
        "Save settings to load Google sign-in for this new OAuth client.",
      detail:
        "This page is still running with the previous OAuth config. Save Settings once so the app reloads with the new client ID, then open Settings again and deploy.",
      steps: [
        "Click Save in Settings. The page will reload.",
        "Open Settings again after reload and confirm Google sign-in is ready.",
        `In Google Cloud, make sure this OAuth client is a Web application and includes ${currentOrigin || "this site origin"} under Authorized JavaScript origins.`,
        "After sign-in is ready, Apps Script deploy also needs Google Apps Script API enabled in the same Google Cloud project.",
      ],
      actions: [
        {
          label: "Open OAuth clients in Cloud Console",
          href: "https://console.cloud.google.com/auth/clients",
        },
        {
          label: "Open Apps Script API in Cloud Console",
          href: "https://console.cloud.google.com/apis/library/script.googleapis.com",
        },
      ],
    };
  }

  return {
    tone:
      h("getGisInitStartedAt") && Date.now() - h("getGisInitStartedAt") >= GIS_INIT_STUCK_MS
        ? "warning"
        : "info",
    message:
      h("getGisInitStartedAt") && Date.now() - h("getGisInitStartedAt") >= GIS_INIT_STUCK_MS
        ? "Google sign-in did not finish loading."
        : "Google sign-in is still loading.",
    detail:
      h("getGisInitStartedAt") && Date.now() - h("getGisInitStartedAt") >= GIS_INIT_STUCK_MS
        ? "Google Identity Services did not finish initializing for this page. This is usually an OAuth client origin mismatch, a blocked Google script, or a browser popup/cookie/privacy setting."
        : "Try Deploy again in a moment.",
    steps:
      h("getGisInitStartedAt") && Date.now() - h("getGisInitStartedAt") >= GIS_INIT_STUCK_MS
        ? [
            "Hard refresh the page once.",
            `In Google Cloud, make sure this OAuth client is a Web application and includes ${currentOrigin || "this site origin"} under Authorized JavaScript origins.`,
            "Allow popups for this site and avoid embedded browser previews that block Google sign-in.",
            "If Sheets sign-in works but Apps Script deploy later fails, then enable Google Apps Script API in the same Google Cloud project.",
          ]
        : [],
    actions: [
      {
        label: "Open OAuth clients in Cloud Console",
        href: "https://console.cloud.google.com/auth/clients",
      },
      {
        label: "Open Apps Script API in Cloud Console",
        href: "https://console.cloud.google.com/apis/library/script.googleapis.com",
      },
    ],
  };
}
async function sha256Hex(text) {
  if (
    typeof crypto === "undefined" ||
    !crypto.subtle ||
    typeof TextEncoder === "undefined"
  ) {
    return "";
  }
  const bytes = new TextEncoder().encode(String(text || ""));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}

async function loadAppsScriptStubBundle() {
  let codeResp;
  let manifestResp;
  try {
    [codeResp, manifestResp] = await Promise.all([
      fetch("integrations/apps-script/Code.gs", { cache: "no-store" }),
      fetch("integrations/apps-script/appsscript.json", { cache: "no-store" }),
    ]);
  } catch (err) {
    if (h("isFetchNetworkError", err)) {
      throw new Error(
        "Could not load the local Apps Script stub files from this site.",
      );
    }
    throw err;
  }
  if (!codeResp.ok || !manifestResp.ok) {
    throw new Error(
      "Could not load integrations/apps-script/Code.gs or appsscript.json.",
    );
  }

  const [codeSource, manifestText] = await Promise.all([
    codeResp.text(),
    manifestResp.text(),
  ]);

  let manifest;
  try {
    manifest = JSON.parse(manifestText);
  } catch (err) {
    throw new Error(
      "integrations/apps-script/appsscript.json is not valid JSON.",
    );
  }

  manifest = manifest && typeof manifest === "object" ? manifest : {};
  manifest.webapp = {
    access: APPS_SCRIPT_WEBAPP_ACCESS,
    executeAs: APPS_SCRIPT_WEBAPP_EXECUTE_AS,
  };
  const manifestSource = JSON.stringify(manifest, null, 2);
  const stubHash = await sha256Hex(`${codeSource}\n---\n${manifestSource}`);

  return {
    files: [
      {
        name: "Code",
        type: "SERVER_JS",
        source: codeSource,
      },
      {
        name: "appsscript",
        type: "JSON",
        source: manifestSource,
      },
    ],
    stubHash,
  };
}

function formatAppsScriptDeployGisError(err) {
  const errType =
    err && typeof err === "object" && err.type != null ? String(err.type) : "";
  const msg =
    err && typeof err === "object" && err.message != null
      ? String(err.message)
      : String(err || "");
  if (
    errType === "popup_failed_to_open" ||
    errType === "popup_closed" ||
    /popup/i.test(msg)
  ) {
    return "Google permission prompt could not open. Allow popups for this site and try again.";
  }
  return "Google did not grant the Apps Script deploy permissions.";
}

function requestAppsScriptDeployAccessToken() {
  const clientId = h("getSettingsOAuthClientIdValue");
  if (!clientId) {
    return Promise.reject(
      new Error("Add an OAuth Client ID above before deploying."),
    );
  }
  if (h("hasUnsavedOAuthClientIdChange", clientId)) {
    return Promise.reject(
      new Error(
        "Save Settings first so the page reloads with this OAuth client ID, then retry Deploy.",
      ),
    );
  }
  if (
    !h("getGisLoaded") ||
    typeof google === "undefined" ||
    !google.accounts ||
    !google.accounts.oauth2
  ) {
    return Promise.reject(
      new Error("Google sign-in is still loading. Try again in a moment."),
    );
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      fn(value);
    };

    let client;
    try {
      client = google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: APPS_SCRIPT_DEPLOY_SCOPES.join(" "),
        include_granted_scopes: true,
        login_hint: h("getUserEmailFromAuth") || undefined,
        callback: (tokenResponse) => {
          if (!tokenResponse || tokenResponse.error) {
            finish(
              reject,
              new Error(
                tokenResponse && tokenResponse.error_description
                  ? tokenResponse.error_description
                  : tokenResponse && tokenResponse.error
                    ? tokenResponse.error
                    : "Google did not return a deploy token.",
              ),
            );
            return;
          }
          if (
            google.accounts.oauth2.hasGrantedAllScopes &&
            !google.accounts.oauth2.hasGrantedAllScopes(
              tokenResponse,
              ...APPS_SCRIPT_DEPLOY_SCOPES,
            )
          ) {
            finish(
              reject,
              new Error(
                "Google did not grant all required Apps Script deploy scopes.",
              ),
            );
            return;
          }
          finish(resolve, tokenResponse.access_token);
        },
        error_callback: (err) => {
          finish(reject, new Error(formatAppsScriptDeployGisError(err)));
        },
      });
      client.requestAccessToken({
        prompt: h("getUserEmailFromAuth") ? "" : "select_account",
      });
    } catch (err) {
      finish(reject, err);
    }
  });
}

async function readAppsScriptApiError(resp) {
  const raw = await resp.text().catch(() => "");
  let data = null;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch (_) {
    data = null;
  }
  const message =
    (data &&
      data.error &&
      typeof data.error === "object" &&
      String(data.error.message || "").trim()) ||
    (data && typeof data.message === "string" && data.message.trim()) ||
    raw.trim() ||
    `HTTP ${resp.status}`;

  const detailTexts = [];
  const detailUrls = [];
  const details =
    data && data.error && Array.isArray(data.error.details)
      ? data.error.details
      : [];

  for (const item of details) {
    if (!item || typeof item !== "object") continue;
    if (typeof item.message === "string" && item.message.trim()) {
      detailTexts.push(item.message.trim());
    }
    if (Array.isArray(item.links)) {
      for (const link of item.links) {
        if (
          link &&
          typeof link === "object" &&
          typeof link.url === "string" &&
          link.url.trim()
        ) {
          detailUrls.push(link.url.trim());
        }
      }
    }
  }

  const urlMatches = `${message}\n${detailTexts.join("\n")}`.match(
    /https:\/\/[^\s)"'<>]+/g,
  );
  if (urlMatches) detailUrls.push(...urlMatches);

  const uniqueUrls = Array.from(
    new Set(
      detailUrls.map((url) =>
        String(url || "")
          .replace(/[.,;:]+$/g, "")
          .trim(),
      ),
    ),
  ).filter(Boolean);

  const fullText = [message, ...detailTexts].filter(Boolean).join(" ");

  if (
    /User has not enabled the Apps Script API/i.test(fullText) ||
    /script\.google\.com\/home\/usersettings/i.test(fullText)
  ) {
    const settingsUrl =
      uniqueUrls.find((url) =>
        /script\.google\.com\/home\/usersettings/i.test(url),
      ) || "https://script.google.com/home/usersettings";
    const err = new Error(message);
    err.deployStatus = {
      tone: "error",
      message: "Enable Apps Script API access in Apps Script user settings.",
      detail:
        "Google says your account has not enabled Apps Script API access for script projects. Open Apps Script user settings, turn on Google Apps Script API access, wait a minute, then retry.",
      actions: [
        {
          label: "Open Apps Script user settings",
          href: settingsUrl,
        },
      ],
    };
    return err;
  }

  if (
    /SERVICE_DISABLED|API has not been used|Access Not Configured|enable it/i.test(
      fullText,
    )
  ) {
    const cloudUrl =
      uniqueUrls.find((url) => /script\.googleapis\.com/i.test(url)) ||
      "https://console.cloud.google.com/apis/library/script.googleapis.com";
    const err = new Error(message);
    err.deployStatus = {
      tone: "error",
      message:
        "Enable Google Apps Script API in the Google Cloud project behind this OAuth client.",
      detail:
        "Google is saying script.googleapis.com is still disabled for the Cloud project that owns this OAuth client ID. Enable it, wait a minute, then retry.",
      actions: [
        {
          label: "Open Apps Script API in Cloud Console",
          href: cloudUrl,
        },
        {
          label: "Open Apps Script user settings",
          href: "https://script.google.com/home/usersettings",
        },
      ],
    };
    return err;
  }

  if (/origin_mismatch/i.test(fullText)) {
    const err = new Error(message);
    err.deployStatus = {
      tone: "error",
      message: "This OAuth client does not allow the current site origin.",
      detail:
        "Add this site under Authorized JavaScript origins in Google Cloud Console, then retry the deploy.",
      actions: [
        {
          label: "Open OAuth clients in Cloud Console",
          href: "https://console.cloud.google.com/auth/clients",
        },
      ],
    };
    return err;
  }

  if (resp.status === 401) {
    const err = new Error(message);
    err.deployStatus = {
      tone: "error",
      message: "Google session expired while deploying.",
      detail: "Retry Deploy and complete the Google permission prompt again.",
      actions: [],
    };
    return err;
  }

  const err = new Error(message);
  err.deployStatus = {
    tone: "error",
    message: "Apps Script deploy failed.",
    detail: message,
    actions: uniqueUrls.length
      ? uniqueUrls.slice(0, 2).map((url) => ({
          label: /script\.google\.com/i.test(url)
            ? "Open Google guidance"
            : "Open related Google console page",
          href: url,
        }))
      : [],
  };
  return err;
}

async function appsScriptApiRequest(path, deployToken, init) {
  const opts = init && typeof init === "object" ? { ...init } : {};
  const headers = new Headers(opts.headers || {});
  headers.set("Authorization", `Bearer ${deployToken}`);
  headers.set("Accept", "application/json");
  if (opts.body != null && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const body =
    opts.body != null && typeof opts.body !== "string"
      ? JSON.stringify(opts.body)
      : opts.body;

  let resp;
  try {
    resp = await fetch(`${APPS_SCRIPT_API_BASE}${path}`, {
      ...opts,
      headers,
      body,
    });
  } catch (err) {
    if (h("isFetchNetworkError", err)) {
      throw new Error(
        "Could not reach the Google Apps Script API from this browser.",
      );
    }
    throw err;
  }

  if (!resp.ok) {
    throw await readAppsScriptApiError(resp);
  }
  if (resp.status === 204) return null;
  return resp.json().catch(() => ({}));
}

function getAppsScriptDeployStateStore() {
  const UC = window.CommandCenterUserContent;
  return UC &&
    typeof UC.getAppsScriptDeployState === "function" &&
    typeof UC.saveAppsScriptDeployState === "function"
    ? UC
    : null;
}

async function populateAppsScriptDeployStateIntoSettingsForm() {
  const store = getAppsScriptDeployStateStore();
  if (!store) {
    configCore.appsScriptDeployStateCache = null;
    renderAppsScriptDeployUi();
    return;
  }
  try {
    configCore.appsScriptDeployStateCache = await store.getAppsScriptDeployState();
  } catch (err) {
    console.warn("[JobBored] Apps Script deploy state:", err);
    configCore.appsScriptDeployStateCache = null;
    configCore.appsScriptDeployStatus = {
      tone: "error",
      message: "Could not load saved Apps Script deploy state.",
      detail: err && err.message ? String(err.message) : "",
    };
  }
  renderAppsScriptDeployUi();
}

function extractWebAppUrlFromDeployment(deployment) {
  const webApp = extractWebAppEntryPointFromDeployment(deployment);
  return webApp.url;
}

function extractWebAppEntryPointFromDeployment(deployment) {
  const entryPoints = Array.isArray(deployment && deployment.entryPoints)
    ? deployment.entryPoints
    : [];
  for (const entryPoint of entryPoints) {
    const webApp =
      entryPoint &&
      entryPoint.entryPointType === "WEB_APP" &&
      entryPoint.webApp &&
      typeof entryPoint.webApp === "object"
        ? entryPoint.webApp
        : null;
    const config =
      webApp &&
      webApp.entryPointConfig &&
      typeof webApp.entryPointConfig === "object"
        ? webApp.entryPointConfig
        : null;
    if (webApp && typeof webApp.url === "string" && webApp.url.trim()) {
      return {
        url: webApp.url.trim(),
        access:
          config && typeof config.access === "string"
            ? config.access.trim()
            : "",
        executeAs:
          config && typeof config.executeAs === "string"
            ? config.executeAs.trim()
            : "",
      };
    }
  }
  return { url: "", access: "", executeAs: "" };
}

async function fetchAppsScriptDeployment(scriptId, deploymentId, deployToken) {
  return appsScriptApiRequest(
    `/projects/${encodeURIComponent(scriptId)}/deployments/${encodeURIComponent(deploymentId)}`,
    deployToken,
    { method: "GET" },
  );
}

function buildAppsScriptPublicProbeUrl(webAppUrl, callbackName) {
  const url = new URL(webAppUrl);
  url.searchParams.set("commandCenterProbe", "1");
  url.searchParams.set("callback", callbackName);
  return url.toString();
}

async function probeAppsScriptWebAppPublicAccess(webAppUrl) {
  if (typeof document === "undefined" || !document.createElement) {
    return { ok: false, reason: "unsupported" };
  }
  return new Promise((resolve) => {
    let settled = false;
    const callbackName = `__jbAppsScriptProbe_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const script = document.createElement("script");
    const cleanup = (result) => {
      if (settled) return;
      settled = true;
      try {
        delete window[callbackName];
      } catch (_) {
        window[callbackName] = undefined;
      }
      if (script.parentNode) script.parentNode.removeChild(script);
      resolve(result);
    };
    const timeoutId = window.setTimeout(() => {
      cleanup({ ok: false, reason: "timeout" });
    }, 12000);

    window[callbackName] = (payload) => {
      window.clearTimeout(timeoutId);
      if (
        payload &&
        payload.ok === true &&
        payload.service === "command-center-apps-script-stub"
      ) {
        cleanup({ ok: true, payload });
        return;
      }
      cleanup({ ok: false, reason: "invalid-payload", payload });
    };

    script.async = true;
    script.src = buildAppsScriptPublicProbeUrl(webAppUrl, callbackName);
    script.onerror = () => {
      window.clearTimeout(timeoutId);
      cleanup({ ok: false, reason: "load-error" });
    };
    (document.head || document.documentElement || document.body).appendChild(
      script,
    );
  });
}

async function verifyAppsScriptDeploymentPublicAccess(
  scriptId,
  deploymentId,
  deployToken,
  existingDeployment,
) {
  const deployment =
    existingDeployment &&
    existingDeployment.deploymentId &&
    String(existingDeployment.deploymentId).trim() ===
      String(deploymentId || "").trim()
      ? existingDeployment
      : await fetchAppsScriptDeployment(scriptId, deploymentId, deployToken);

  const webAppEntry = extractWebAppEntryPointFromDeployment(deployment);
  if (!webAppEntry.url) {
    throw new Error(
      "Google deployed the script but did not return a web app /exec URL.",
    );
  }

  const statePatch = {
    webAppUrl: webAppEntry.url,
    access: webAppEntry.access || "",
    executeAs: webAppEntry.executeAs || "",
    deploymentAccess: webAppEntry.access || "",
    deploymentExecuteAs: webAppEntry.executeAs || "",
    publicAccessCheckedAt: new Date().toISOString(),
  };

  if (
    webAppEntry.access !== APPS_SCRIPT_WEBAPP_ACCESS ||
    webAppEntry.executeAs !== APPS_SCRIPT_WEBAPP_EXECUTE_AS
  ) {
    return {
      ready: false,
      statePatch: {
        ...statePatch,
        publicAccessState: APPS_SCRIPT_PUBLIC_ACCESS_NEEDS_REMEDIATION,
        publicAccessIssue: "deployment-config",
      },
      deployStatus: relayHelpers.buildAppsScriptPublicAccessRemediationStatus({
        scriptId,
        webAppUrl: webAppEntry.url,
        deploymentAccess: webAppEntry.access,
        deploymentExecuteAs: webAppEntry.executeAs,
        failureKind: "deployment-config",
      }),
    };
  }

  const probe = await probeAppsScriptWebAppPublicAccess(webAppEntry.url);
  if (!probe.ok) {
    return {
      ready: false,
      statePatch: {
        ...statePatch,
        publicAccessState: APPS_SCRIPT_PUBLIC_ACCESS_NEEDS_REMEDIATION,
        publicAccessIssue: "probe",
      },
      deployStatus: relayHelpers.buildAppsScriptPublicAccessRemediationStatus({
        scriptId,
        webAppUrl: webAppEntry.url,
        deploymentAccess: webAppEntry.access,
        deploymentExecuteAs: webAppEntry.executeAs,
        failureKind: "probe",
      }),
    };
  }

  return {
    ready: true,
    statePatch: {
      ...statePatch,
      publicAccessState: APPS_SCRIPT_PUBLIC_ACCESS_READY,
      publicAccessIssue: "",
    },
    deployStatus: null,
  };
}
function refreshSerpApiCalloutStatus() {
  const el = document.getElementById("settingsSerpApiCallout");
  const badge = document.getElementById("settingsSerpApiCalloutStatus");
  if (!el || !badge) return;
  const snapshot = h("getDiscoveryReadinessSnapshot");
  const webhookUrl = (snapshot && snapshot.savedWebhookUrl) || "";
  // Only attempt the probe for locally-reachable workers. A Cloudflare
  // relay hides the real /health from the browser, so skip the probe in
  // that case and leave the callout neutral.
  const isLocalHost = /(^|\/\/)(localhost|127\.0\.0\.1)(:|\/|$)/i.test(
    webhookUrl,
  );
  if (!webhookUrl || !isLocalHost) {
    el.dataset.configured = "unknown";
    badge.textContent = "Worker status unknown";
    return;
  }
  const healthUrl = (() => {
    try {
      const u = new URL(webhookUrl);
      u.pathname = "/health";
      u.search = "";
      u.hash = "";
      return u.toString();
    } catch (_) {
      return "";
    }
  })();
  if (!healthUrl) {
    el.dataset.configured = "unknown";
    badge.textContent = "Worker status unknown";
    return;
  }
  fetch(healthUrl, { method: "GET", mode: "cors" })
    .then(async (r) => (r.ok ? r.json() : null))
    .then((payload) => {
      const flag =
        payload && payload.readiness && payload.readiness.serpApiGoogleJobs;
      if (!flag) {
        el.dataset.configured = "unknown";
        badge.textContent = "Worker too old to report";
        return;
      }
      if (flag.configured) {
        el.dataset.configured = "yes";
        badge.textContent = "✓ Configured";
      } else {
        el.dataset.configured = "no";
        badge.textContent = "Not configured";
      }
    })
    .catch(() => {
      el.dataset.configured = "unknown";
      badge.textContent = "Worker unreachable";
    });
}
function renderAppsScriptDeployUi() {
  const deployBtn = document.getElementById("settingsAppsScriptDeployBtn");
  const recheckBtn = document.getElementById("settingsAppsScriptRecheckBtn");
  const openBtn = document.getElementById("settingsAppsScriptOpenBtn");
  const copyBtn = document.getElementById("settingsAppsScriptCopyBtn");
  const statusCard = document.getElementById("settingsAppsScriptStatus");
  const statusTitle = document.getElementById("settingsAppsScriptStatusTitle");
  const statusDetail = document.getElementById(
    "settingsAppsScriptStatusDetail",
  );
  const statusSteps = document.getElementById("settingsAppsScriptStatusSteps");
  const statusUrlRow = document.getElementById("settingsAppsScriptUrlRow");
  const statusUrl = document.getElementById("settingsAppsScriptUrl");
  const statusActions = document.getElementById(
    "settingsAppsScriptStatusActions",
  );
  if (!deployBtn || !statusCard || !statusTitle || !statusDetail) return;

  const state = configCore.appsScriptDeployStateCache;
  const hasManaged = statusApi.isManagedAppsScriptDeployState(state);
  const publicAccessReady = statusApi.isAppsScriptPublicAccessReady(state);
  const scriptId =
    state && typeof state.scriptId === "string" ? state.scriptId.trim() : "";
  const webAppUrl =
    state && typeof state.webAppUrl === "string" ? state.webAppUrl.trim() : "";
  const clientId = h("getSettingsOAuthClientIdValue");
  const sheetId = h("getSettingsSheetIdValue");
  const needsOAuthReload = h("hasUnsavedOAuthClientIdChange", clientId);

  deployBtn.textContent = configCore.appsScriptDeployBusy
    ? "Deploying..."
    : hasManaged
      ? "Re-deploy managed Apps Script"
      : "Deploy Google Apps Script stub";
  deployBtn.disabled =
    configCore.appsScriptDeployBusy ||
    !clientId ||
    !sheetId ||
    needsOAuthReload ||
    !h("getGisLoaded");

  if (!clientId) {
    deployBtn.title = "Add an OAuth Client ID above first";
  } else if (needsOAuthReload) {
    deployBtn.title =
      "Save Settings so the page reloads with this OAuth client";
  } else if (!sheetId) {
    deployBtn.title = "Paste a spreadsheet URL or Sheet ID above first";
  } else if (!h("getGisLoaded")) {
    deployBtn.title = "Google sign-in is still loading";
  } else {
    deployBtn.title = hasManaged
      ? "Upload the latest stub and refresh the managed web app deployment"
      : "Create and deploy a new managed Apps Script web app";
  }

  if (openBtn) {
    const href = relayHelpers.getAppsScriptEditorUrl(scriptId);
    openBtn.hidden = !href;
    openBtn.href = href || "#";
  }
  if (recheckBtn) {
    recheckBtn.hidden =
      !hasManaged || publicAccessReady || configCore.appsScriptDeployBusy || !scriptId;
    recheckBtn.disabled =
      configCore.appsScriptDeployBusy || !h("getGisLoaded") || !clientId || needsOAuthReload;
    if (!clientId) {
      recheckBtn.title = "Add an OAuth Client ID above first";
    } else if (needsOAuthReload) {
      recheckBtn.title =
        "Save Settings so the page reloads with this OAuth client";
    } else if (!h("getGisLoaded")) {
      recheckBtn.title = "Google sign-in is still loading";
    } else {
      recheckBtn.title =
        "Re-read the managed deployment and rerun the anonymous public-access probe";
    }
  }
  if (copyBtn) {
    copyBtn.hidden = !webAppUrl;
    copyBtn.disabled = !webAppUrl;
  }
  if (statusActions) {
    statusActions.innerHTML = "";
  }
  if (statusSteps) {
    statusSteps.innerHTML = "";
    statusSteps.hidden = true;
  }

  let tone = "info";
  let message =
    "Create a new Apps Script stub in your Google Drive and save its /exec URL here.";
  let detail =
    "This keeps webhook verification in your account. Browser -> /exec requests may still need a proxy or server-side POST if CORS blocks them, and the stub still needs real discovery logic before it can add jobs.";
  let effectiveStatus = configCore.appsScriptDeployStatus;

  if (configCore.appsScriptDeployStatus && configCore.appsScriptDeployStatus.message) {
    tone = configCore.appsScriptDeployStatus.tone || "info";
    message = configCore.appsScriptDeployStatus.message;
    detail = configCore.appsScriptDeployStatus.detail || "";
  } else if (!clientId) {
    tone = "warning";
    message = "Add an OAuth Client ID above to deploy from the dashboard.";
    detail =
      "Use the same Google OAuth web client you use for Sheets access on this site.";
  } else if (!sheetId) {
    tone = "warning";
    message = "Paste a spreadsheet URL or Sheet ID above first.";
    detail =
      "The deploy flow saves the resulting /exec URL for the sheet you’re configuring.";
  } else if (needsOAuthReload) {
    effectiveStatus = buildAppsScriptGisNotReadyStatus(clientId);
    tone = effectiveStatus.tone;
    message = effectiveStatus.message;
    detail = effectiveStatus.detail;
  } else if (!h("getGisLoaded")) {
    effectiveStatus = buildAppsScriptGisNotReadyStatus(clientId);
    tone = effectiveStatus.tone;
    message = effectiveStatus.message;
    detail = effectiveStatus.detail;
  } else if (hasManaged && !publicAccessReady) {
    const remediation = relayHelpers.buildAppsScriptPublicAccessRemediationStatus({
      scriptId,
      webAppUrl,
      deploymentAccess:
        state && typeof state.deploymentAccess === "string"
          ? state.deploymentAccess
          : state && typeof state.access === "string"
            ? state.access
            : "",
      deploymentExecuteAs:
        state && typeof state.deploymentExecuteAs === "string"
          ? state.deploymentExecuteAs
          : state && typeof state.executeAs === "string"
            ? state.executeAs
            : "",
      failureKind:
        state && typeof state.publicAccessIssue === "string"
          ? state.publicAccessIssue
          : "",
    });
    tone = remediation.tone;
    message = remediation.message;
    detail = remediation.detail;
    effectiveStatus = remediation;
  } else if (hasManaged) {
    tone = "success";
    message = "Managed Apps Script stub ready.";
    detail =
      "The saved web app URL passed the public-access check, but this managed deploy is still only a webhook stub. It can verify wiring, not discover real jobs.";
  }

  statusCard.className = `settings-apps-script-status settings-apps-script-status--${tone}`;
  statusTitle.textContent = message;
  statusDetail.textContent = detail;
  if (
    statusSteps &&
    effectiveStatus &&
    Array.isArray(effectiveStatus.steps) &&
    effectiveStatus.steps.length
  ) {
    for (const step of effectiveStatus.steps) {
      const item = document.createElement("li");
      item.textContent = step;
      statusSteps.appendChild(item);
    }
    statusSteps.hidden = false;
  }
  if (
    statusActions &&
    effectiveStatus &&
    Array.isArray(effectiveStatus.actions) &&
    effectiveStatus.actions.length
  ) {
    for (const action of effectiveStatus.actions) {
      const link = document.createElement("a");
      link.className = action.primary
        ? "settings-apps-script-status__action btn-discovery-setup"
        : "settings-apps-script-status__action btn-discovery-setup btn-discovery-setup--secondary";
      link.href = action.href;
      link.target = "_blank";
      link.rel = "noopener";
      link.textContent = action.label;
      statusActions.appendChild(link);
    }
    statusActions.hidden = false;
  } else if (statusActions) {
    statusActions.hidden = true;
  }

  if (statusUrlRow && statusUrl) {
    const hideRawExecUrl = hasManaged && !publicAccessReady && webAppUrl;
    statusUrlRow.hidden = !webAppUrl || hideRawExecUrl;
    statusUrl.textContent = webAppUrl;
  }
  h("renderDiscoveryEngineStatusUi");
}

async function deployAppsScriptStubFromSettings() {
  if (configCore.appsScriptDeployBusy) return;

  const sheetId = h("getSettingsSheetIdValue");
  if (!sheetId) {
    statusApi.setAppsScriptDeployStatus(
      "warning",
      "Paste a spreadsheet URL or Sheet ID above first.",
    );
    return;
  }

  const oauthClientId = h("getSettingsOAuthClientIdValue");
  if (!oauthClientId) {
    statusApi.setAppsScriptDeployStatus(
      "warning",
      "Add an OAuth Client ID above before deploying.",
    );
    return;
  }

  configCore.appsScriptDeployBusy = true;
  renderAppsScriptDeployUi();

  try {
    statusApi.setAppsScriptDeployStatus(
      "info",
      "Requesting Google Apps Script deploy permissions…",
    );
    const deployToken = await requestAppsScriptDeployAccessToken();

    statusApi.setAppsScriptDeployStatus("info", "Loading the repo’s Apps Script stub…");
    const stub = await loadAppsScriptStubBundle();

    const existingState = statusApi.isManagedAppsScriptDeployState(
      configCore.appsScriptDeployStateCache,
    )
      ? configCore.appsScriptDeployStateCache
      : null;

    let scriptId =
      existingState && existingState.scriptId
        ? String(existingState.scriptId).trim()
        : "";
    let deploymentId =
      existingState && existingState.deploymentId
        ? String(existingState.deploymentId).trim()
        : "";

    if (!scriptId) {
      statusApi.setAppsScriptDeployStatus("info", "Creating a new Apps Script project…");
      const project = await appsScriptApiRequest("/projects", deployToken, {
        method: "POST",
        body: { title: APPS_SCRIPT_PROJECT_TITLE },
      });
      scriptId = String(
        project && project.scriptId ? project.scriptId : "",
      ).trim();
      if (!scriptId) {
        throw new Error(
          "Google created a project but did not return a scriptId.",
        );
      }
    }

    statusApi.setAppsScriptDeployStatus("info", "Uploading Code.gs and appsscript.json…");
    await appsScriptApiRequest(
      `/projects/${encodeURIComponent(scriptId)}/content`,
      deployToken,
      {
        method: "PUT",
        body: { files: stub.files },
      },
    );

    statusApi.setAppsScriptDeployStatus("info", "Creating a new script version…");
    const version = await appsScriptApiRequest(
      `/projects/${encodeURIComponent(scriptId)}/versions`,
      deployToken,
      {
        method: "POST",
        body: { description: "Command Center dashboard deploy" },
      },
    );
    const versionNumber =
      Number(version && version.versionNumber) > 0
        ? Number(version.versionNumber)
        : null;
    if (!versionNumber) {
      throw new Error(
        "Google created a version but did not return a version number.",
      );
    }

    let deployment;
    if (deploymentId) {
      statusApi.setAppsScriptDeployStatus(
        "info",
        "Updating the managed web app deployment…",
      );
      deployment = await appsScriptApiRequest(
        `/projects/${encodeURIComponent(scriptId)}/deployments/${encodeURIComponent(deploymentId)}`,
        deployToken,
        {
          method: "PUT",
          body: {
            deploymentConfig: {
              scriptId,
              versionNumber,
              manifestFileName: "appsscript",
              description: "Command Center dashboard deploy",
            },
          },
        },
      );
    } else {
      statusApi.setAppsScriptDeployStatus("info", "Creating the web app deployment…");
      deployment = await appsScriptApiRequest(
        `/projects/${encodeURIComponent(scriptId)}/deployments`,
        deployToken,
        {
          method: "POST",
          body: {
            versionNumber,
            manifestFileName: "appsscript",
            description: "Command Center dashboard deploy",
          },
        },
      );
    }

    deploymentId = String(
      deployment && deployment.deploymentId ? deployment.deploymentId : "",
    ).trim();
    const webAppUrl = extractWebAppUrlFromDeployment(deployment);
    if (!deploymentId || !webAppUrl) {
      throw new Error(
        "Google deployed the script but did not return a web app /exec URL.",
      );
    }

    statusApi.setAppsScriptDeployStatus(
      "info",
      "Checking that Google published the web app as public…",
      "Command Center will not save this /exec URL as ready until an anonymous public-access probe succeeds.",
    );
    const readiness = await verifyAppsScriptDeploymentPublicAccess(
      scriptId,
      deploymentId,
      deployToken,
      deployment,
    );

    const store = getAppsScriptDeployStateStore();
    let nextState = {
      managedBy: APPS_SCRIPT_MANAGED_BY,
      origin: window.location.origin || "",
      ownerEmail: h("getUserEmailFromAuth") || "",
      scriptId,
      deploymentId,
      webAppUrl,
      executeAs: APPS_SCRIPT_WEBAPP_EXECUTE_AS,
      access: APPS_SCRIPT_WEBAPP_ACCESS,
      projectTitle: APPS_SCRIPT_PROJECT_TITLE,
      lastVersionNumber: versionNumber,
      stubHash: stub.stubHash,
      lastDeployedAt: new Date().toISOString(),
      ...readiness.statePatch,
    };
    if (store) {
      nextState = await store.saveAppsScriptDeployState(nextState);
      if (readiness.ready && typeof store.saveAgentChecklist === "function") {
        await store.saveAgentChecklist({ webhookConfigured: true });
      }
    }
    configCore.appsScriptDeployStateCache = nextState;

    if (!readiness.ready) {
      statusApi.setAppsScriptDeployStatus(
        readiness.deployStatus.tone || "error",
        readiness.deployStatus.message ||
          "Apps Script public-access check failed.",
        readiness.deployStatus.detail || "",
        {
          actions: Array.isArray(readiness.deployStatus.actions)
            ? readiness.deployStatus.actions
            : [],
          steps: Array.isArray(readiness.deployStatus.steps)
            ? readiness.deployStatus.steps
            : [],
        },
      );
      return;
    }

    const urlField = document.getElementById("settingsDiscoveryWebhookUrl");
    if (urlField) urlField.value = webAppUrl;
    h("mergeStoredConfigOverridePatch", {
      sheetId,
      oauthClientId,
      discoveryWebhookUrl: webAppUrl,
    });
    await h(
      "recordDiscoveryEngineState",
      webAppUrl,
      DISCOVERY_ENGINE_STATE_STUB_ONLY,
      "managed_apps_script_deploy",
    );
    h("syncDiscoveryButtonState");

    statusApi.setAppsScriptDeployStatus(
      "success",
      "Apps Script stub deployed and webhook URL was saved.",
      "This confirms webhook wiring only. Use Test webhook for smoke tests, then connect a real discovery engine or replace the stub logic before expecting job rows.",
    );
  } catch (err) {
    console.error("[JobBored] Apps Script deploy:", err);
    const deployStatus =
      err && err.deployStatus && typeof err.deployStatus === "object"
        ? err.deployStatus
        : null;
    if (deployStatus) {
      statusApi.setAppsScriptDeployStatus(
        deployStatus.tone || "error",
        deployStatus.message || "Apps Script deploy failed.",
        deployStatus.detail || (err && err.message ? String(err.message) : ""),
        Array.isArray(deployStatus.actions) ? deployStatus.actions : [],
      );
    } else {
      statusApi.setAppsScriptDeployStatus(
        "error",
        "Apps Script deploy failed.",
        err && err.message ? String(err.message) : "Unknown error",
      );
    }
  } finally {
    configCore.appsScriptDeployBusy = false;
    renderAppsScriptDeployUi();
  }
}

async function recheckAppsScriptPublicAccessFromSettings() {
  if (configCore.appsScriptDeployBusy) return;
  const state = configCore.appsScriptDeployStateCache;
  if (!statusApi.isManagedAppsScriptDeployState(state)) return;

  const scriptId =
    state && typeof state.scriptId === "string" ? state.scriptId.trim() : "";
  const deploymentId =
    state && typeof state.deploymentId === "string"
      ? state.deploymentId.trim()
      : "";
  const webAppUrl =
    state && typeof state.webAppUrl === "string" ? state.webAppUrl.trim() : "";
  if (!scriptId || !deploymentId) return;

  const sheetId = h("getSettingsSheetIdValue");
  const oauthClientId = h("getSettingsOAuthClientIdValue");
  if (!oauthClientId) {
    statusApi.setAppsScriptDeployStatus(
      "warning",
      "Add an OAuth Client ID above before re-checking.",
    );
    return;
  }

  configCore.appsScriptDeployBusy = true;
  renderAppsScriptDeployUi();
  try {
    statusApi.setAppsScriptDeployStatus(
      "info",
      "Re-checking Google web app public access…",
      "This does not redeploy code. It only re-reads the managed deployment and reruns the anonymous public-access probe.",
    );
    const deployToken = await requestAppsScriptDeployAccessToken();
    const readiness = await verifyAppsScriptDeploymentPublicAccess(
      scriptId,
      deploymentId,
      deployToken,
      null,
    );

    const store = getAppsScriptDeployStateStore();
    let nextState = {
      ...(state && typeof state === "object" ? state : {}),
      ...readiness.statePatch,
      webAppUrl: readiness.statePatch.webAppUrl || webAppUrl,
      lastDeployedAt:
        state && typeof state.lastDeployedAt === "string"
          ? state.lastDeployedAt
          : "",
    };

    if (store) {
      nextState = await store.saveAppsScriptDeployState(nextState);
      if (readiness.ready && typeof store.saveAgentChecklist === "function") {
        await store.saveAgentChecklist({ webhookConfigured: true });
      }
    }
    configCore.appsScriptDeployStateCache = nextState;

    if (!readiness.ready) {
      statusApi.setAppsScriptDeployStatus(
        readiness.deployStatus.tone || "error",
        readiness.deployStatus.message ||
          "Apps Script public-access check failed.",
        readiness.deployStatus.detail || "",
        {
          actions: Array.isArray(readiness.deployStatus.actions)
            ? readiness.deployStatus.actions
            : [],
          steps: Array.isArray(readiness.deployStatus.steps)
            ? readiness.deployStatus.steps
            : [],
        },
      );
      return;
    }

    const finalWebAppUrl =
      readiness.statePatch.webAppUrl || nextState.webAppUrl || webAppUrl;
    const urlField = document.getElementById("settingsDiscoveryWebhookUrl");
    if (urlField) urlField.value = finalWebAppUrl;
    h("mergeStoredConfigOverridePatch", {
      ...(sheetId ? { sheetId } : {}),
      ...(oauthClientId ? { oauthClientId } : {}),
      discoveryWebhookUrl: finalWebAppUrl,
    });
    await h(
      "recordDiscoveryEngineState",
      finalWebAppUrl,
      DISCOVERY_ENGINE_STATE_STUB_ONLY,
      "managed_apps_script_recheck",
    );
    h("syncDiscoveryButtonState");

    statusApi.setAppsScriptDeployStatus(
      "success",
      "Apps Script stub now passes the public-access check and webhook URL was saved.",
      "This still leaves discovery in stub-only mode. Use Test webhook for smoke tests, and connect a real discovery engine before expecting Pipeline rows.",
    );
  } catch (err) {
    console.error("[JobBored] Apps Script public access re-check:", err);
    const deployStatus =
      err && err.deployStatus && typeof err.deployStatus === "object"
        ? err.deployStatus
        : null;
    if (deployStatus) {
      statusApi.setAppsScriptDeployStatus(
        deployStatus.tone || "error",
        deployStatus.message || "Apps Script public-access check failed.",
        deployStatus.detail || (err && err.message ? String(err.message) : ""),
        {
          actions: Array.isArray(deployStatus.actions)
            ? deployStatus.actions
            : [],
          steps: Array.isArray(deployStatus.steps) ? deployStatus.steps : [],
        },
      );
    } else {
      statusApi.setAppsScriptDeployStatus(
        "error",
        "Apps Script public-access check failed.",
        err && err.message ? String(err.message) : "Unknown error",
      );
    }
  } finally {
    configCore.appsScriptDeployBusy = false;
    renderAppsScriptDeployUi();
  }
}

  Object.assign(appsScriptDeploy, {
    getAppsScriptDeployStateStore,
    populateAppsScriptDeployStateIntoSettingsForm,
    refreshSerpApiCalloutStatus,
    renderAppsScriptDeployUi,
    deployAppsScriptStubFromSettings,
    recheckAppsScriptPublicAccessFromSettings,
  });
})();
