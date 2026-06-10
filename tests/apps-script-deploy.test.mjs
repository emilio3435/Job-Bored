import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const appsScriptDeployJs = readFileSync(
  join(repoRoot, "apps-script-deploy.js"),
  "utf8",
);

// ============================================================
// Behavioral coverage for apps-script-deploy.js.
//
// The module is a classic-global IIFE under
// window.JobBoredDiscovery.appsScriptDeploy. At LOAD time it dereferences
// window.JobBoredApp.configCore, window.JobBoredDiscovery.relayHelpers and
// window.JobBoredDiscovery.status, so the VM context pre-seeds all three with
// recording stubs BEFORE running the source (mirrors loadDiscoveryUi in
// discovery-cross-rec.test.mjs). All network goes through a recording
// fetchImpl; the JSONP public-access probe is driven by a fake document.head
// that parses the callback name off the injected script's src; the probe's
// 12s timeout rides a fake window.setTimeout so tests fire it manually.
// ============================================================

const WEB_APP_URL = "https://script.google.com/macros/s/ABC123/exec";

function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

// Objects created inside the VM realm carry a foreign Object.prototype, which
// deepStrictEqual rejects. Round-trip them before structural comparison.
function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function jsonResponse(data, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    json: async () => data,
    text: async () => JSON.stringify(data),
  };
}

function textResponse(text, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    text: async () => text,
    json: async () => JSON.parse(text),
  };
}

function makeDeploymentPayload(overrides = {}) {
  return {
    deploymentId: overrides.deploymentId || "DEPLOY456",
    entryPoints: [
      {
        entryPointType: "WEB_APP",
        webApp: {
          url: overrides.url || WEB_APP_URL,
          entryPointConfig: {
            access: overrides.access || "ANYONE_ANONYMOUS",
            executeAs: overrides.executeAs || "USER_DEPLOYING",
          },
        },
      },
    ],
  };
}

// A minimal recording element for the few ids render/serpapi tests need.
function makeEl() {
  return {
    textContent: "",
    hidden: false,
    disabled: false,
    title: "",
    href: "",
    className: "",
    innerHTML: "",
    value: "",
    dataset: {},
    children: [],
    appendChild(child) {
      this.children.push(child);
    },
  };
}

function loadDeployHarness(opts = {}) {
  const calls = {
    status: [],
    remediation: [],
    merged: [],
    engineStates: [],
    savedStates: [],
    checklists: [],
    fetches: [],
    tokenRequests: [],
  };

  const configCore = {
    APPS_SCRIPT_API_BASE: "https://script.googleapis.com/v1",
    APPS_SCRIPT_DEPLOY_SCOPES: [
      "https://www.googleapis.com/auth/script.projects",
      "https://www.googleapis.com/auth/script.deployments",
    ],
    APPS_SCRIPT_MANAGED_BY: "command-center",
    APPS_SCRIPT_PROJECT_TITLE: "Command Center discovery webhook",
    APPS_SCRIPT_WEBAPP_ACCESS: "ANYONE_ANONYMOUS",
    APPS_SCRIPT_WEBAPP_EXECUTE_AS: "USER_DEPLOYING",
    APPS_SCRIPT_PUBLIC_ACCESS_READY: "ready",
    APPS_SCRIPT_PUBLIC_ACCESS_NEEDS_REMEDIATION: "needs_remediation",
    DISCOVERY_ENGINE_STATE_STUB_ONLY: "stub_only",
    GIS_INIT_STUCK_MS: 8000,
    appsScriptDeployStateCache:
      opts.deployStateCache !== undefined ? opts.deployStateCache : null,
    appsScriptDeployBusy: false,
    appsScriptDeployStatus: null,
  };

  const statusApi = {
    setAppsScriptDeployStatus: (tone, message, detail, extra) => {
      calls.status.push({
        tone,
        message: String(message || ""),
        detail: detail ? String(detail) : "",
        extra: extra === undefined ? null : extra,
      });
      configCore.appsScriptDeployStatus = {
        tone,
        message: String(message || ""),
        detail: detail ? String(detail) : "",
      };
    },
    isManagedAppsScriptDeployState: (state) =>
      !!(
        state &&
        typeof state === "object" &&
        String(state.managedBy || "") === "command-center" &&
        String(state.scriptId || "").trim()
      ),
    isAppsScriptPublicAccessReady(state) {
      if (!statusApi.isManagedAppsScriptDeployState(state)) return false;
      const status = String(state.publicAccessState || "").trim();
      if (!status) return !!String(state.webAppUrl || "").trim();
      return status === "ready";
    },
  };

  const relayHelpers = {
    buildAppsScriptPublicAccessRemediationStatus: (args) => {
      calls.remediation.push(args);
      return {
        tone: "warning",
        message: `remediation:${args.failureKind}`,
        detail: "Google web app is not publicly accessible yet.",
        steps: ["Re-publish the web app as Anyone (anonymous)."],
        actions: [
          { label: "Open editor", href: "https://script.google.com/d/X/edit" },
        ],
      };
    },
    getAppsScriptEditorUrl: (scriptId) =>
      scriptId
        ? `https://script.google.com/home/projects/${scriptId}/edit`
        : "",
  };

  // The probe's 12s timeout must never run on the wall clock: record it and
  // let tests fire it by hand.
  const timers = { scheduled: [], cleared: [] };
  const appendedProbeScripts = [];
  const probeBehavior = opts.probeBehavior || "ok"; // ok | invalid | load-error | hang

  const elements = new Map();
  if (opts.elements) {
    for (const [id, el] of Object.entries(opts.elements)) elements.set(id, el);
  }

  const windowObj = {
    location: { origin: "https://dashboard.example.test" },
    setTimeout: (fn, ms) => timers.scheduled.push({ fn, ms }),
    clearTimeout: (id) => timers.cleared.push(id),
  };

  function driveProbeScript(script) {
    appendedProbeScripts.push(script);
    const callbackName = new URL(script.src).searchParams.get("callback");
    if (probeBehavior === "hang") return;
    if (probeBehavior === "load-error") {
      script.onerror();
      return;
    }
    if (probeBehavior === "invalid") {
      windowObj[callbackName]({ ok: false, service: "someone-else" });
      return;
    }
    windowObj[callbackName]({
      ok: true,
      service: "command-center-apps-script-stub",
    });
  }

  const documentObj = {
    getElementById: (id) => elements.get(id) || null,
    createElement: (tag) => {
      const el = makeEl();
      el.tagName = String(tag || "").toLowerCase();
      return el;
    },
    head: {
      appendChild: (script) => driveProbeScript(script),
    },
  };

  const gis = { behavior: "grant", token: "tok-123", ...(opts.gis || {}) };
  const google = {
    accounts: {
      oauth2: {
        initTokenClient: (cfg) => ({
          requestAccessToken: (reqOpts) => {
            calls.tokenRequests.push({
              scope: cfg.scope,
              prompt: reqOpts && reqOpts.prompt,
            });
            if (gis.behavior === "popup-error") {
              cfg.error_callback({
                type: "popup_failed_to_open",
                message: "popup blocked",
              });
              return;
            }
            cfg.callback({ access_token: gis.token });
          },
        }),
        hasGrantedAllScopes: () => gis.behavior !== "deny-scopes",
      },
    },
  };

  const stubCode =
    opts.stubCode !== undefined
      ? opts.stubCode
      : "function doPost(e) { return stubReply(e); }";
  const stubManifest =
    opts.stubManifest !== undefined
      ? opts.stubManifest
      : JSON.stringify({
          timeZone: "Etc/UTC",
          webapp: { access: "MYSELF", executeAs: "USER_ACCESSING" },
        });

  const api = opts.api || null; // (record) => response | undefined, may throw

  async function fetchImpl(url, init = {}) {
    const record = {
      url: String(url),
      method: (init && init.method) || "GET",
      headers: (init && init.headers) || null,
      body: init && init.body != null ? init.body : null,
    };
    calls.fetches.push(record);
    const u = record.url;
    if (u === "integrations/apps-script/Code.gs") return textResponse(stubCode);
    if (u === "integrations/apps-script/appsscript.json") {
      return textResponse(stubManifest);
    }
    if (api) {
      const out = api(record);
      if (out !== undefined) return out;
    }
    if (/\/v1\/projects$/.test(u) && record.method === "POST") {
      return jsonResponse({ scriptId: "SCRIPT123" });
    }
    if (/\/content$/.test(u) && record.method === "PUT") {
      return jsonResponse({});
    }
    if (/\/versions$/.test(u) && record.method === "POST") {
      return jsonResponse({ versionNumber: 7 });
    }
    if (/\/deployments$/.test(u) && record.method === "POST") {
      return jsonResponse(makeDeploymentPayload(opts.deployment));
    }
    if (/\/deployments\/[^/]+$/.test(u)) {
      return jsonResponse(makeDeploymentPayload(opts.deployment));
    }
    throw new Error(`unstubbed fetch: ${record.method} ${u}`);
  }

  const store =
    opts.store !== undefined
      ? opts.store
      : {
          getAppsScriptDeployState: async () =>
            opts.storedState !== undefined ? opts.storedState : null,
          saveAppsScriptDeployState: async (state) => {
            calls.savedStates.push(state);
            return { ...state };
          },
          saveAgentChecklist: async (patch) => {
            calls.checklists.push(patch);
          },
        };
  if (store) windowObj.CommandCenterUserContent = store;

  const host = {
    getSettingsOAuthClientIdValue: () =>
      opts.clientId !== undefined
        ? opts.clientId
        : "client-123.apps.googleusercontent.com",
    getSettingsSheetIdValue: () =>
      opts.sheetId !== undefined ? opts.sheetId : "sheet-abc",
    hasUnsavedOAuthClientIdChange: () => !!opts.unsavedOAuthChange,
    getGisLoaded: () => opts.gisLoaded !== false,
    getGisInitStartedAt: () => 0,
    getUserEmailFromAuth: () =>
      opts.userEmail !== undefined ? opts.userEmail : "user@example.com",
    isFetchNetworkError: (err) => !!(err && err.__network),
    mergeStoredConfigOverridePatch: (patch) => calls.merged.push(patch),
    recordDiscoveryEngineState: async (url, state, reason) =>
      calls.engineStates.push({ url, state, reason }),
    syncDiscoveryButtonState: () => {},
    renderDiscoveryEngineStatusUi: () => {},
    getDiscoveryReadinessSnapshot: () => opts.readinessSnapshot || null,
    ...(opts.host || {}),
  };

  windowObj.JobBoredApp = { configCore };
  windowObj.JobBoredDiscovery = { relayHelpers, status: statusApi };

  const ctx = {
    window: windowObj,
    document: documentObj,
    console: { log() {}, warn() {}, error() {} },
    setTimeout,
    clearTimeout,
    URL,
    Headers,
    fetch: fetchImpl,
    google,
  };
  vm.createContext(ctx);
  vm.runInContext(appsScriptDeployJs, ctx, {
    filename: "apps-script-deploy.js",
  });

  const deploy = windowObj.JobBoredDiscovery.appsScriptDeploy;
  deploy.host = host;

  return {
    window: windowObj,
    configCore,
    deploy,
    calls,
    timers,
    appendedProbeScripts,
    elements,
    lastStatus: () => calls.status[calls.status.length - 1],
    googleApiFetches: () =>
      calls.fetches.filter((f) => f.url.includes("script.googleapis.com")),
  };
}

// ============================================================
// Namespace registration + deploy-state store gate
// ============================================================

describe("apps-script-deploy — namespace registration + deploy-state store gate", () => {
  it("registers all six settings-facing entry points under window.JobBoredDiscovery.appsScriptDeploy so app.js can drive deploy without module internals", () => {
    const h = loadDeployHarness();
    for (const name of [
      "getAppsScriptDeployStateStore",
      "populateAppsScriptDeployStateIntoSettingsForm",
      "refreshSerpApiCalloutStatus",
      "renderAppsScriptDeployUi",
      "deployAppsScriptStubFromSettings",
      "recheckAppsScriptPublicAccessFromSettings",
    ]) {
      assert.equal(
        typeof h.deploy[name],
        "function",
        `${name} must be exported`,
      );
    }
  });

  it("hands back the user-content store only when BOTH read and write exist — a half-implemented store would silently lose deploy state", () => {
    const h = loadDeployHarness({ store: null });

    h.window.CommandCenterUserContent = undefined;
    assert.equal(h.deploy.getAppsScriptDeployStateStore(), null);

    h.window.CommandCenterUserContent = {
      getAppsScriptDeployState: async () => null,
      // saveAppsScriptDeployState missing
    };
    assert.equal(
      h.deploy.getAppsScriptDeployStateStore(),
      null,
      "read-only store must be rejected, not half-used",
    );

    const full = {
      getAppsScriptDeployState: async () => null,
      saveAppsScriptDeployState: async (s) => s,
    };
    h.window.CommandCenterUserContent = full;
    assert.equal(h.deploy.getAppsScriptDeployStateStore(), full);
  });
});

// ============================================================
// populate — cache hydration from the persisted store
// ============================================================

describe("apps-script-deploy — populate hydrates the deploy-state cache for Settings", () => {
  it("hydrates configCore.appsScriptDeployStateCache from the store so Settings reflects an existing managed deploy after reload", async () => {
    const saved = {
      managedBy: "command-center",
      scriptId: "SCRIPT123",
      webAppUrl: WEB_APP_URL,
    };
    const h = loadDeployHarness({ storedState: saved });
    await h.deploy.populateAppsScriptDeployStateIntoSettingsForm();
    assert.deepEqual(h.configCore.appsScriptDeployStateCache, saved);
  });

  it("a store read failure surfaces an error status instead of silently pretending there is no saved deploy", async () => {
    const h = loadDeployHarness({
      store: {
        getAppsScriptDeployState: async () => {
          throw new Error("IndexedDB wedged");
        },
        saveAppsScriptDeployState: async (s) => s,
      },
    });
    await h.deploy.populateAppsScriptDeployStateIntoSettingsForm();
    assert.equal(h.configCore.appsScriptDeployStateCache, null);
    assert.equal(h.configCore.appsScriptDeployStatus.tone, "error");
    assert.match(
      h.configCore.appsScriptDeployStatus.message,
      /Could not load saved Apps Script deploy state/,
    );
    assert.match(
      h.configCore.appsScriptDeployStatus.detail,
      /IndexedDB wedged/,
    );
  });

  it("without a persistence store the cache resets to null (greenfield) instead of keeping a stale in-memory deploy", async () => {
    const h = loadDeployHarness({
      store: null,
      deployStateCache: { managedBy: "command-center", scriptId: "STALE" },
    });
    h.window.CommandCenterUserContent = undefined;
    await h.deploy.populateAppsScriptDeployStateIntoSettingsForm();
    assert.equal(h.configCore.appsScriptDeployStateCache, null);
  });
});

// ============================================================
// Deploy state machine — new-project happy path
// ============================================================

describe("apps-script-deploy — deploy state machine: new-project happy path", () => {
  it("first deploy walks create→upload→version→deploy in order and probes public access without re-fetching the deployment it just created", async () => {
    const h = loadDeployHarness();
    await h.deploy.deployAppsScriptStubFromSettings();

    const apiSteps = h
      .googleApiFetches()
      .map((f) => `${f.method} ${f.url.replace(/^.*\/v1/, "")}`);
    assert.deepEqual(apiSteps, [
      "POST /projects",
      "PUT /projects/SCRIPT123/content",
      "POST /projects/SCRIPT123/versions",
      "POST /projects/SCRIPT123/deployments",
    ]);

    assert.equal(
      h.appendedProbeScripts.length,
      1,
      "the /exec URL must be probed anonymously before being trusted",
    );
    const probeUrl = new URL(h.appendedProbeScripts[0].src);
    assert.equal(
      `${probeUrl.origin}${probeUrl.pathname}`,
      WEB_APP_URL,
      "the probe must hit the deployed web app URL",
    );
    assert.equal(probeUrl.searchParams.get("commandCenterProbe"), "1");
    assert.ok(probeUrl.searchParams.get("callback"));
  });

  it("every Apps Script API call carries the deploy token as a Bearer header — an unauthenticated call would 401 mid-deploy", async () => {
    const h = loadDeployHarness();
    await h.deploy.deployAppsScriptStubFromSettings();
    const apiFetches = h.googleApiFetches();
    assert.ok(apiFetches.length > 0);
    for (const f of apiFetches) {
      assert.equal(f.headers.get("Authorization"), "Bearer tok-123");
    }
  });

  it("the uploaded manifest FORCES the public webapp config (ANYONE_ANONYMOUS / USER_DEPLOYING) regardless of what the repo manifest says — otherwise the probe can never pass", async () => {
    const h = loadDeployHarness({
      stubManifest: JSON.stringify({
        timeZone: "Etc/UTC",
        webapp: { access: "MYSELF", executeAs: "USER_ACCESSING" },
      }),
    });
    await h.deploy.deployAppsScriptStubFromSettings();
    const contentPut = h
      .googleApiFetches()
      .find((f) => f.method === "PUT" && /\/content$/.test(f.url));
    assert.ok(contentPut, "must upload project content");
    const body = JSON.parse(contentPut.body);
    const code = body.files.find((f) => f.name === "Code");
    assert.equal(code.type, "SERVER_JS");
    assert.match(code.source, /stubReply/);
    const manifest = JSON.parse(
      body.files.find((f) => f.name === "appsscript").source,
    );
    assert.equal(manifest.webapp.access, "ANYONE_ANONYMOUS");
    assert.equal(manifest.webapp.executeAs, "USER_DEPLOYING");
    assert.equal(manifest.timeZone, "Etc/UTC", "other manifest keys survive");
  });

  it("a verified deploy persists the managed state as ready and marks the agent checklist webhookConfigured", async () => {
    const h = loadDeployHarness();
    await h.deploy.deployAppsScriptStubFromSettings();

    assert.equal(h.calls.savedStates.length, 1);
    const state = h.calls.savedStates[0];
    assert.equal(state.managedBy, "command-center");
    assert.equal(state.scriptId, "SCRIPT123");
    assert.equal(state.deploymentId, "DEPLOY456");
    assert.equal(state.webAppUrl, WEB_APP_URL);
    assert.equal(state.publicAccessState, "ready");
    assert.equal(state.publicAccessIssue, "");
    assert.equal(state.lastVersionNumber, 7);
    assert.equal(
      state.origin,
      "https://dashboard.example.test",
      "the deploy records which dashboard origin owns it",
    );
    assert.deepEqual(plain(h.calls.checklists), [{ webhookConfigured: true }]);
    assert.equal(h.configCore.appsScriptDeployStateCache.publicAccessState, "ready");
  });

  it("a verified deploy adopts the /exec URL (config patch + webhook field) and records stub_only — deploy proves wiring, never a real engine", async () => {
    const urlField = makeEl();
    const h = loadDeployHarness({
      elements: { settingsDiscoveryWebhookUrl: urlField },
    });
    await h.deploy.deployAppsScriptStubFromSettings();

    assert.equal(urlField.value, WEB_APP_URL);
    assert.deepEqual(plain(h.calls.merged), [
      {
        sheetId: "sheet-abc",
        oauthClientId: "client-123.apps.googleusercontent.com",
        discoveryWebhookUrl: WEB_APP_URL,
      },
    ]);
    assert.deepEqual(h.calls.engineStates, [
      {
        url: WEB_APP_URL,
        state: "stub_only",
        reason: "managed_apps_script_deploy",
      },
    ]);
    const last = h.lastStatus();
    assert.equal(last.tone, "success");
    assert.match(last.message, /deployed and webhook URL was saved/);
    assert.match(
      last.detail,
      /confirms webhook wiring only/,
      "success copy must not oversell the stub",
    );
    assert.equal(h.configCore.appsScriptDeployBusy, false);
  });

  it("a corrupted local manifest aborts before ANY Google API traffic — no half-created project from a broken repo file", async () => {
    const h = loadDeployHarness({ stubManifest: "{not json" });
    await h.deploy.deployAppsScriptStubFromSettings();
    assert.equal(h.googleApiFetches().length, 0);
    const last = h.lastStatus();
    assert.equal(last.tone, "error");
    assert.match(last.detail, /appsscript\.json is not valid JSON/);
    assert.equal(h.calls.savedStates.length, 0);
  });
});

// ============================================================
// Deploy state machine — re-deploy with existing managed state
// ============================================================

describe("apps-script-deploy — re-deploy reuses the managed project and deployment", () => {
  it("an existing managed state skips project creation and UPDATES the deployment in place — a POST would mint a duplicate web app with a NEW /exec URL", async () => {
    const h = loadDeployHarness({
      deployStateCache: {
        managedBy: "command-center",
        scriptId: "SCRIPT123",
        deploymentId: "DEPLOY456",
        webAppUrl: WEB_APP_URL,
      },
    });
    await h.deploy.deployAppsScriptStubFromSettings();

    const apiSteps = h
      .googleApiFetches()
      .map((f) => `${f.method} ${f.url.replace(/^.*\/v1/, "")}`);
    assert.ok(
      !apiSteps.includes("POST /projects"),
      "must not create a second project",
    );
    assert.ok(
      apiSteps.includes("PUT /projects/SCRIPT123/deployments/DEPLOY456"),
      "must update the managed deployment in place",
    );
    assert.ok(
      !apiSteps.includes("POST /projects/SCRIPT123/deployments"),
      "must not create a duplicate deployment",
    );
    assert.equal(h.lastStatus().tone, "success");
  });
});

// ============================================================
// Deploy guards — fail fast before any Google traffic
// ============================================================

describe("apps-script-deploy — deploy guards fail fast before any Google traffic", () => {
  it("a deploy already in flight is a no-op — no duplicate token prompts or racing API writes", async () => {
    const h = loadDeployHarness();
    h.configCore.appsScriptDeployBusy = true;
    await h.deploy.deployAppsScriptStubFromSettings();
    assert.equal(h.calls.status.length, 0);
    assert.equal(h.calls.fetches.length, 0);
    assert.equal(h.calls.tokenRequests.length, 0);
  });

  it("missing Sheet ID stops with a warning before requesting any token — there is nothing to attach the /exec URL to", async () => {
    const h = loadDeployHarness({ sheetId: "" });
    await h.deploy.deployAppsScriptStubFromSettings();
    assert.equal(h.calls.status.length, 1);
    assert.equal(h.calls.status[0].tone, "warning");
    assert.match(h.calls.status[0].message, /Paste a spreadsheet URL or Sheet ID/);
    assert.equal(h.calls.fetches.length, 0);
    assert.equal(h.calls.tokenRequests.length, 0);
  });

  it("missing OAuth client ID stops with a warning before requesting any token", async () => {
    const h = loadDeployHarness({ clientId: "" });
    await h.deploy.deployAppsScriptStubFromSettings();
    assert.equal(h.calls.status[0].tone, "warning");
    assert.match(h.calls.status[0].message, /Add an OAuth Client ID/);
    assert.equal(h.calls.fetches.length, 0);
    assert.equal(h.calls.tokenRequests.length, 0);
  });

  it("an unsaved OAuth client change aborts the token request — deploying on the OLD client would mint a token for the wrong app", async () => {
    const h = loadDeployHarness({ unsavedOAuthChange: true });
    await h.deploy.deployAppsScriptStubFromSettings();
    const last = h.lastStatus();
    assert.equal(last.tone, "error");
    assert.match(last.detail, /Save Settings first/);
    assert.equal(h.googleApiFetches().length, 0);
    assert.equal(h.configCore.appsScriptDeployBusy, false, "busy flag released");
  });

  it("GIS not loaded yet fails honestly with 'still loading' instead of hanging the deploy", async () => {
    const h = loadDeployHarness({ gisLoaded: false });
    await h.deploy.deployAppsScriptStubFromSettings();
    const last = h.lastStatus();
    assert.equal(last.tone, "error");
    assert.match(last.detail, /Google sign-in is still loading/);
    assert.equal(h.googleApiFetches().length, 0);
  });

  it("partially granted scopes abort the deploy — a weak token would fail half-way through with a confusing Google error", async () => {
    const h = loadDeployHarness({ gis: { behavior: "deny-scopes" } });
    await h.deploy.deployAppsScriptStubFromSettings();
    const last = h.lastStatus();
    assert.equal(last.tone, "error");
    assert.match(last.detail, /did not grant all required/);
    assert.equal(h.googleApiFetches().length, 0);
  });

  it("a blocked permission popup maps to actionable 'allow popups' guidance, not a raw GIS error object", async () => {
    const h = loadDeployHarness({ gis: { behavior: "popup-error" } });
    await h.deploy.deployAppsScriptStubFromSettings();
    const last = h.lastStatus();
    assert.equal(last.tone, "error");
    assert.match(last.detail, /Allow popups for this site/);
  });
});

// ============================================================
// Public-access verification honesty
// ============================================================

describe("apps-script-deploy — public-access verification never saves an unverified /exec URL as usable", () => {
  it("a deployment that came back without ANYONE_ANONYMOUS access is persisted as needs_remediation and the webhook URL is NOT adopted", async () => {
    const h = loadDeployHarness({ deployment: { access: "MYSELF" } });
    await h.deploy.deployAppsScriptStubFromSettings();

    assert.equal(h.appendedProbeScripts.length, 0, "no point probing a known-private deploy");
    assert.equal(h.calls.savedStates.length, 1, "the managed state is still saved for recheck");
    assert.equal(h.calls.savedStates[0].publicAccessState, "needs_remediation");
    assert.equal(h.calls.savedStates[0].publicAccessIssue, "deployment-config");
    assert.equal(h.calls.remediation.length, 1);
    assert.equal(h.calls.remediation[0].failureKind, "deployment-config");
    assert.equal(h.calls.merged.length, 0, "config must not adopt a private URL");
    assert.equal(h.calls.engineStates.length, 0);
    assert.equal(h.calls.checklists.length, 0, "checklist must not claim webhookConfigured");
    assert.equal(h.lastStatus().message, "remediation:deployment-config");
  });

  it("a probe answered by the WRONG service (not the command-center stub) still counts as a failure — any 200 from a login wall must not pass", async () => {
    const h = loadDeployHarness({ probeBehavior: "invalid" });
    await h.deploy.deployAppsScriptStubFromSettings();
    assert.equal(h.calls.savedStates[0].publicAccessState, "needs_remediation");
    assert.equal(h.calls.savedStates[0].publicAccessIssue, "probe");
    assert.equal(h.calls.remediation[0].failureKind, "probe");
    assert.equal(h.calls.merged.length, 0);
    assert.equal(h.lastStatus().message, "remediation:probe");
  });

  it("a probe script load error (Google auth wall / 403 page) routes to probe remediation", async () => {
    const h = loadDeployHarness({ probeBehavior: "load-error" });
    await h.deploy.deployAppsScriptStubFromSettings();
    assert.equal(h.calls.savedStates[0].publicAccessIssue, "probe");
    assert.equal(h.calls.merged.length, 0);
    assert.equal(h.lastStatus().message, "remediation:probe");
  });

  it("a probe that never answers resolves via the armed timeout timer and routes to probe remediation — no infinite 'checking…' spinner", async () => {
    const h = loadDeployHarness({ probeBehavior: "hang" });
    const pending = h.deploy.deployAppsScriptStubFromSettings();
    for (let i = 0; i < 50 && h.appendedProbeScripts.length === 0; i++) {
      await flush();
    }
    assert.equal(h.appendedProbeScripts.length, 1, "probe script must be injected");
    assert.ok(h.timers.scheduled.length >= 1, "the probe must arm a timeout");
    h.timers.scheduled[h.timers.scheduled.length - 1].fn();
    await pending;
    assert.equal(h.calls.savedStates[0].publicAccessIssue, "probe");
    assert.equal(h.calls.merged.length, 0);
    assert.equal(h.configCore.appsScriptDeployBusy, false);
  });

  it("the JSONP callback is removed from window even when the probe fails — leaked globals would collide on the next probe", async () => {
    const h = loadDeployHarness({ probeBehavior: "load-error" });
    await h.deploy.deployAppsScriptStubFromSettings();
    const leaked = Object.keys(h.window).filter((k) =>
      k.startsWith("__jbAppsScriptProbe"),
    );
    assert.deepEqual(leaked, []);
  });
});

// ============================================================
// Google API error classification → actionable remediation
// ============================================================

describe("apps-script-deploy — Google API errors map to actionable remediation, not raw payloads", () => {
  function failProjects(response) {
    return (record) => {
      if (/\/v1\/projects$/.test(record.url) && record.method === "POST") {
        if (typeof response === "function") return response();
        return response;
      }
      return undefined;
    };
  }

  it("'user has not enabled the Apps Script API' routes to Apps Script USER settings with the Google-provided link", async () => {
    const h = loadDeployHarness({
      api: failProjects(
        jsonResponse(
          {
            error: {
              message:
                "User has not enabled the Apps Script API. Enable it by visiting https://script.google.com/home/usersettings then retry.",
            },
          },
          { ok: false, status: 403 },
        ),
      ),
    });
    await h.deploy.deployAppsScriptStubFromSettings();
    const last = h.lastStatus();
    assert.equal(last.tone, "error");
    assert.match(last.message, /Enable Apps Script API access in Apps Script user settings/);
    assert.ok(Array.isArray(last.extra), "actions ride along for the status card");
    assert.equal(
      last.extra[0].href,
      "https://script.google.com/home/usersettings",
    );
  });

  it("SERVICE_DISABLED routes to enabling script.googleapis.com in the OAuth client's Cloud project", async () => {
    const h = loadDeployHarness({
      api: failProjects(
        jsonResponse(
          {
            error: {
              message:
                "Apps Script API has not been used in project 12345 before or it is disabled.",
              details: [
                {
                  message: "Enable it then retry.",
                  links: [
                    {
                      url: "https://console.cloud.google.com/apis/library/script.googleapis.com?project=12345",
                    },
                  ],
                },
              ],
            },
          },
          { ok: false, status: 403 },
        ),
      ),
    });
    await h.deploy.deployAppsScriptStubFromSettings();
    const last = h.lastStatus();
    assert.match(last.message, /Enable Google Apps Script API in the Google Cloud project/);
    assert.equal(
      last.extra[0].href,
      "https://console.cloud.google.com/apis/library/script.googleapis.com?project=12345",
      "the Google-provided deep link wins over the generic library URL",
    );
  });

  it("a 401 mid-deploy reads as an expired Google session with retry guidance", async () => {
    const h = loadDeployHarness({
      api: failProjects(jsonResponse({}, { ok: false, status: 401 })),
    });
    await h.deploy.deployAppsScriptStubFromSettings();
    const last = h.lastStatus();
    assert.equal(last.tone, "error");
    assert.equal(last.message, "Google session expired while deploying.");
    assert.match(last.detail, /Retry Deploy/);
  });

  it("a network/CORS failure against the Apps Script API reads as 'could not reach', not a raw TypeError", async () => {
    const h = loadDeployHarness({
      api: failProjects(() => {
        const err = new TypeError("Failed to fetch");
        err.__network = true;
        throw err;
      }),
    });
    await h.deploy.deployAppsScriptStubFromSettings();
    const last = h.lastStatus();
    assert.equal(last.tone, "error");
    assert.equal(
      last.detail,
      "Could not reach the Google Apps Script API from this browser.",
    );
  });

  it("any other API error keeps Google's own message as the detail and harvests at most two links as actions", async () => {
    const h = loadDeployHarness({
      api: failProjects(
        jsonResponse(
          {
            error: {
              message:
                "Quota exceeded. See https://example.com/a and https://example.com/b plus https://example.com/c",
            },
          },
          { ok: false, status: 429 },
        ),
      ),
    });
    await h.deploy.deployAppsScriptStubFromSettings();
    const last = h.lastStatus();
    assert.equal(last.message, "Apps Script deploy failed.");
    assert.match(last.detail, /Quota exceeded/);
    assert.equal(last.extra.length, 2, "action list is capped at two links");
  });
});

// ============================================================
// Recheck public access — no redeploy
// ============================================================

describe("apps-script-deploy — recheck re-probes public access without redeploying", () => {
  const managedState = {
    managedBy: "command-center",
    scriptId: "SCRIPT123",
    deploymentId: "DEPLOY456",
    webAppUrl: WEB_APP_URL,
    publicAccessState: "needs_remediation",
    publicAccessIssue: "probe",
    lastDeployedAt: "2026-01-01T00:00:00.000Z",
  };

  it("recheck is a no-op without a managed deploy state — there is nothing to probe and no status churn", async () => {
    const h = loadDeployHarness({ deployStateCache: null });
    await h.deploy.recheckAppsScriptPublicAccessFromSettings();
    assert.equal(h.calls.fetches.length, 0);
    assert.equal(h.calls.status.length, 0);
    assert.equal(h.calls.tokenRequests.length, 0);
  });

  it("recheck re-reads the deployment from Google instead of trusting the cache — access fixed in the Apps Script editor must become visible", async () => {
    const h = loadDeployHarness({ deployStateCache: { ...managedState } });
    await h.deploy.recheckAppsScriptPublicAccessFromSettings();
    const apiSteps = h
      .googleApiFetches()
      .map((f) => `${f.method} ${f.url.replace(/^.*\/v1/, "")}`);
    assert.deepEqual(
      apiSteps,
      ["GET /projects/SCRIPT123/deployments/DEPLOY456"],
      "recheck must only READ the deployment — no content upload, version, or deploy",
    );
  });

  it("a recheck that passes persists ready state, preserves lastDeployedAt, and adopts the URL with the recheck reason", async () => {
    const h = loadDeployHarness({ deployStateCache: { ...managedState } });
    await h.deploy.recheckAppsScriptPublicAccessFromSettings();

    assert.equal(h.calls.savedStates.length, 1);
    assert.equal(h.calls.savedStates[0].publicAccessState, "ready");
    assert.equal(
      h.calls.savedStates[0].lastDeployedAt,
      "2026-01-01T00:00:00.000Z",
      "recheck does not redeploy, so the deploy timestamp must survive",
    );
    assert.deepEqual(plain(h.calls.checklists), [{ webhookConfigured: true }]);
    assert.equal(h.calls.merged.length, 1);
    assert.equal(h.calls.merged[0].discoveryWebhookUrl, WEB_APP_URL);
    assert.deepEqual(h.calls.engineStates, [
      {
        url: WEB_APP_URL,
        state: "stub_only",
        reason: "managed_apps_script_recheck",
      },
    ]);
    const last = h.lastStatus();
    assert.equal(last.tone, "success");
    assert.match(last.message, /now passes the public-access check/);
    assert.equal(h.configCore.appsScriptDeployBusy, false);
  });

  it("a recheck that still fails the probe keeps needs_remediation and does NOT adopt the URL", async () => {
    const h = loadDeployHarness({
      deployStateCache: { ...managedState },
      probeBehavior: "invalid",
    });
    await h.deploy.recheckAppsScriptPublicAccessFromSettings();
    assert.equal(h.calls.savedStates[0].publicAccessState, "needs_remediation");
    assert.equal(h.calls.savedStates[0].publicAccessIssue, "probe");
    assert.equal(h.calls.merged.length, 0);
    assert.equal(h.calls.engineStates.length, 0);
    assert.equal(h.calls.checklists.length, 0);
    assert.equal(h.lastStatus().message, "remediation:probe");
  });
});

// ============================================================
// SerpAPI callout — worker /health probe
// ============================================================

describe("apps-script-deploy — SerpAPI callout probes only locally reachable workers", () => {
  function calloutEls() {
    return {
      settingsSerpApiCallout: makeEl(),
      settingsSerpApiCalloutStatus: makeEl(),
    };
  }

  it("non-local webhook URLs skip the /health probe entirely — a relay hides the real worker health, so guessing would mislead", async () => {
    const els = calloutEls();
    const h = loadDeployHarness({
      elements: els,
      readinessSnapshot: {
        savedWebhookUrl: "https://relay.example.workers.dev/webhook",
      },
    });
    h.deploy.refreshSerpApiCalloutStatus();
    await flush();
    assert.equal(h.calls.fetches.length, 0);
    assert.equal(els.settingsSerpApiCallout.dataset.configured, "unknown");
    assert.equal(
      els.settingsSerpApiCalloutStatus.textContent,
      "Worker status unknown",
    );
  });

  it("a local worker is probed at /health with the query stripped, and a configured SerpAPI shows the configured badge", async () => {
    const els = calloutEls();
    const h = loadDeployHarness({
      elements: els,
      readinessSnapshot: {
        savedWebhookUrl: "http://localhost:8644/webhook?secret=shh",
      },
      api: (record) => {
        if (record.url === "http://localhost:8644/health") {
          return jsonResponse({
            readiness: { serpApiGoogleJobs: { configured: true } },
          });
        }
        return undefined;
      },
    });
    h.deploy.refreshSerpApiCalloutStatus();
    await flush();
    assert.equal(
      h.calls.fetches[0].url,
      "http://localhost:8644/health",
      "the probe must not leak the webhook secret query to /health",
    );
    assert.equal(els.settingsSerpApiCallout.dataset.configured, "yes");
    assert.equal(els.settingsSerpApiCalloutStatus.textContent, "✓ Configured");
  });

  it("a worker that does not report the flag is called out as too old instead of guessing yes/no", async () => {
    const els = calloutEls();
    const h = loadDeployHarness({
      elements: els,
      readinessSnapshot: { savedWebhookUrl: "http://127.0.0.1:8644/webhook" },
      api: (record) =>
        record.url.endsWith("/health") ? jsonResponse({}) : undefined,
    });
    h.deploy.refreshSerpApiCalloutStatus();
    await flush();
    assert.equal(els.settingsSerpApiCallout.dataset.configured, "unknown");
    assert.equal(
      els.settingsSerpApiCalloutStatus.textContent,
      "Worker too old to report",
    );
  });

  it("an unreachable worker reads 'Worker unreachable' instead of leaving a stale badge or throwing", async () => {
    const els = calloutEls();
    const h = loadDeployHarness({
      elements: els,
      readinessSnapshot: { savedWebhookUrl: "http://localhost:8644/webhook" },
      api: (record) => {
        if (record.url.endsWith("/health")) {
          const err = new TypeError("Failed to fetch");
          err.__network = true;
          throw err;
        }
        return undefined;
      },
    });
    h.deploy.refreshSerpApiCalloutStatus();
    await flush();
    assert.equal(els.settingsSerpApiCallout.dataset.configured, "unknown");
    assert.equal(
      els.settingsSerpApiCalloutStatus.textContent,
      "Worker unreachable",
    );
  });
});

// ============================================================
// Settings render — deploy button gating + managed status honesty
// ============================================================

describe("apps-script-deploy — settings render gates the deploy button and stays honest about stub state", () => {
  function renderEls() {
    return {
      settingsAppsScriptDeployBtn: makeEl(),
      settingsAppsScriptRecheckBtn: makeEl(),
      settingsAppsScriptOpenBtn: makeEl(),
      settingsAppsScriptCopyBtn: makeEl(),
      settingsAppsScriptStatus: makeEl(),
      settingsAppsScriptStatusTitle: makeEl(),
      settingsAppsScriptStatusDetail: makeEl(),
      settingsAppsScriptStatusSteps: makeEl(),
      settingsAppsScriptUrlRow: makeEl(),
      settingsAppsScriptUrl: makeEl(),
      settingsAppsScriptStatusActions: makeEl(),
    };
  }

  it("the deploy button stays disabled until both OAuth client and Sheet ID exist — clicking earlier could only fail later", () => {
    const els = renderEls();
    const h = loadDeployHarness({ elements: els, sheetId: "" });
    h.deploy.renderAppsScriptDeployUi();
    assert.ok(els.settingsAppsScriptDeployBtn.disabled, "no sheet → disabled");
    assert.match(
      els.settingsAppsScriptDeployBtn.title,
      /Paste a spreadsheet URL or Sheet ID/,
    );
    assert.equal(
      els.settingsAppsScriptStatusTitle.textContent,
      "Paste a spreadsheet URL or Sheet ID above first.",
    );

    const els2 = renderEls();
    const h2 = loadDeployHarness({ elements: els2 });
    h2.deploy.renderAppsScriptDeployUi();
    assert.equal(
      els2.settingsAppsScriptDeployBtn.disabled,
      false,
      "client + sheet + GIS ready → deploy enabled",
    );
  });

  it("a managed deploy that passed the probe renders success but STILL calls itself a stub — never promise a real discovery engine", () => {
    const els = renderEls();
    const h = loadDeployHarness({
      elements: els,
      deployStateCache: {
        managedBy: "command-center",
        scriptId: "SCRIPT123",
        deploymentId: "DEPLOY456",
        webAppUrl: WEB_APP_URL,
        publicAccessState: "ready",
      },
    });
    h.deploy.renderAppsScriptDeployUi();
    assert.match(els.settingsAppsScriptStatus.className, /--success/);
    assert.equal(
      els.settingsAppsScriptStatusTitle.textContent,
      "Managed Apps Script stub ready.",
    );
    assert.match(
      els.settingsAppsScriptStatusDetail.textContent,
      /still only a webhook stub/,
    );
    assert.equal(
      els.settingsAppsScriptDeployBtn.textContent,
      "Re-deploy managed Apps Script",
    );
    assert.ok(
      els.settingsAppsScriptRecheckBtn.hidden,
      "nothing to recheck once public access is ready",
    );
    assert.ok(!els.settingsAppsScriptUrlRow.hidden, "the verified URL is shown");
    assert.equal(els.settingsAppsScriptUrl.textContent, WEB_APP_URL);
  });

  it("a managed deploy stuck in needs_remediation shows the remediation guidance, offers recheck, and HIDES the raw /exec URL — an unverified URL must not look usable", () => {
    const els = renderEls();
    const h = loadDeployHarness({
      elements: els,
      deployStateCache: {
        managedBy: "command-center",
        scriptId: "SCRIPT123",
        deploymentId: "DEPLOY456",
        webAppUrl: WEB_APP_URL,
        publicAccessState: "needs_remediation",
        publicAccessIssue: "probe",
      },
    });
    h.deploy.renderAppsScriptDeployUi();
    assert.equal(
      els.settingsAppsScriptStatusTitle.textContent,
      "remediation:probe",
    );
    assert.equal(h.calls.remediation[0].failureKind, "probe");
    assert.equal(
      els.settingsAppsScriptRecheckBtn.hidden,
      false,
      "recheck is the way out of remediation",
    );
    assert.ok(
      els.settingsAppsScriptUrlRow.hidden,
      "the raw /exec URL row must be hidden while unverified",
    );
  });
});
