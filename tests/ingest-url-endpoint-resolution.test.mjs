import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { readIndexHtml } from "../scripts/lib/expand-index-includes.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const appJs = readFileSync(join(repoRoot, "app.js"), "utf8");
const appCompatJs = readFileSync(join(repoRoot, "app-compat.js"), "utf8");
const statusHandoffJs = readFileSync(
  join(repoRoot, "discovery-status-handoff.js"),
  "utf8",
);
const probesJs = readFileSync(join(repoRoot, "discovery-wizard-probes.js"), "utf8");
const indexHtml = readIndexHtml(repoRoot);

const ingestUrlFlowJs = readFileSync(
  join(repoRoot, "ingest-url-flow.js"),
  "utf8",
);
const runOrchJs = readFileSync(
  join(repoRoot, "discovery-run-orchestration.js"),
  "utf8",
);
const readinessJs = readFileSync(
  join(repoRoot, "discovery-readiness.js"),
  "utf8",
);

function readIngestFunctionSource(name, endMarker) {
  return readFunctionSource(name, endMarker, ingestUrlFlowJs);
}

function readIngestAsyncFunctionSource(name, endMarker) {
  return readAsyncFunctionSource(name, endMarker, ingestUrlFlowJs);
}

const ingestUrlFlowVmPreamble = `
function host() { return globalThis.__ingestHost || globalThis; }
function h(name, ...args) {
  const fn = host()[name];
  return typeof fn === "function" ? fn(...args) : undefined;
}
`;

const ingestUrlFlowStatusApiTail = `
const statusApi = {
  resolveAcceptedRunStatusPath,
  buildRunStatusUrl,
  buildDiscoveryStatusPollHeaders,
};
`;

function readIngestUrlSubmitSupportBundle() {
  return [
    completeFunction(
      readIngestFunctionSource(
        "resolveIngestUrlEndpoint",
        "\n}\n\nfunction isParseableUrl",
      ),
    ),
    completeFunction(
      readIngestFunctionSource(
        "createIngestVerificationError",
        "\n}\n\nfunction classifyIngestEndpointFailure",
      ),
    ),
    completeFunction(
      readIngestFunctionSource(
        "classifyIngestEndpointFailure",
        "\n}\n\nfunction classifyIngestNetworkFailure",
      ),
    ),
    completeFunction(
      readIngestFunctionSource(
        "classifyIngestNetworkFailure",
        "\n}\n\nfunction formatDiscoveryVerificationError",
      ),
    ),
    completeFunction(
      readIngestFunctionSource(
        "reportIngestProgress",
        "\n}\n\nfunction getDuplicatePipelineIndexFromIngest",
      ),
    ),
  ].join("\n");
}

function buildIngestSubmitVmScript(statusAndAppSources, includeStatusApiTail = false) {
  const submitFn = completeFunction(
    readIngestAsyncFunctionSource(
      "handleIngestUrlSubmit",
      "\n}\n\nfunction getIngestManualModalEls",
    ),
  );
  const statusApiBlock = includeStatusApiTail ? ingestUrlFlowStatusApiTail : "";
  return (
    ingestAuthVmPreamble +
    statusAndAppSources +
    statusApiBlock +
    ingestUrlFlowVmPreamble +
    readIngestUrlSubmitSupportBundle() +
    "\n" +
    submitFn
  );
}



function readFunctionSource(name, endMarker, source = appJs) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} must exist`);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(end, -1, `${name} body must be readable`);
  return source.slice(start, end);
}

function readAsyncFunctionSource(name, endMarker, source = appJs) {
  const start = source.indexOf(`async function ${name}(`);
  assert.notEqual(start, -1, `${name} must exist`);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(end, -1, `${name} body must be readable`);
  return source.slice(start, end);
}

function readStatusFunctionSource(name, endMarker) {
  return readFunctionSource(name, endMarker, statusHandoffJs);
}

function jsonResponse({ ok, status, body }) {
  return {
    ok,
    status,
    url: "http://127.0.0.1:8644/ingest-url",
    async text() {
      return JSON.stringify(body);
    },
    async json() {
      return body;
    },
  };
}

function completeFunction(source) {
  return `${source}\n}`;
}

async function flushMicrotasks(iterations = 40) {
  for (let i = 0; i < iterations; i += 1) {
    await Promise.resolve();
  }
}

function loadIngestUrlPromotionHarness({
  url = "https://referrals.example.test/jobs/123",
  company = "JobBored",
  inferredTitle = "Lifecycle Marketing Manager",
  inferredCompany = "Acme Labs",
  inferredLocation = "Remote",
} = {}) {
  const jobs = [{
    link: url,
    title: "View",
    company,
    location: "",
    logoUrl: "",
  }];
  const updates = [];
  const host = {
    showToast() {},
    loadAllData: async () => {},
    getPipelineData: () => jobs,
    normalizeLeadUrlClient(value) {
      try {
        const parsed = new URL(value);
        return parsed.hostname.toLowerCase().replace(/^www\./, "") + parsed.pathname.replace(/\/+$/, "");
      } catch {
        return String(value || "").trim();
      }
    },
    fetchJobPostingEnrichment: async (idx) => {
      jobs[idx]._postingEnrichment = {
        inferredTitle,
        inferredCompany,
        inferredLocation,
      };
    },
    getSheetRow: () => 7,
    isPlaceholderLogoUrl: () => false,
    resolveCompanyLogoUrl: async () => "",
    updateMultipleCells: async (batch) => {
      updates.push(...batch);
      return true;
    },
    renderPipeline() {},
    getCurrentSearch: () => "",
    getFavoritesOnly: () => false,
  };
  const context = vm.createContext({
    window: {
      JobBoredDiscovery: {
        status: {},
        ingestUrlFlow: { host },
      },
    },
    document: {
      getElementById: () => null,
      querySelector: () => null,
      querySelectorAll: () => [],
    },
    console: { log() {}, info() {}, warn() {}, error() {} },
    setTimeout,
    clearTimeout,
    URL,
  });

  vm.runInContext(ingestUrlFlowJs, context, { filename: "ingest-url-flow.js" });
  return {
    api: context.window.JobBoredDiscovery.ingestUrlFlow,
    jobs,
    updates,
    url,
  };
}

function loadIngestManualFallbackHarness() {
  const elements = {
    ingestManualModal: { style: { display: "none" }, addEventListener() {} },
    ingestManualForm: { resetCalled: false, reset() { this.resetCalled = true; } },
    ingestManualUrl: { value: "" },
    ingestManualModalExplain: { textContent: "" },
    ingestManualModalError: { style: {}, textContent: "" },
    ingestManualTitle: { focusCalled: false, focus() { this.focusCalled = true; } },
    ingestManualCompany: { value: "" },
    ingestManualLocation: { value: "" },
    ingestManualDescription: { value: "" },
    ingestManualFitScore: { value: "" },
    ingestManualFitScoreValue: { textContent: "" },
    ingestManualSubmit: {},
    ingestManualCancel: {},
    ingestManualModalClose: {},
  };
  const toasts = [];
  const host = {
    showToast(...args) {
      toasts.push(args);
      return () => {};
    },
    getPipelineData: () => [],
    getCurrentSearch: () => "",
    getFavoritesOnly: () => false,
  };
  const context = vm.createContext({
    window: {
      JobBoredDiscovery: {
        status: {},
        ingestUrlFlow: { host },
      },
    },
    document: {
      getElementById: (id) => elements[id] || null,
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener() {},
      body: { classList: { add() {}, remove() {} } },
    },
    console: { log() {}, info() {}, warn() {}, error() {} },
    setTimeout(fn) {
      if (typeof fn === "function") fn();
      return 0;
    },
    clearTimeout,
    URL,
  });

  vm.runInContext(ingestUrlFlowJs, context, { filename: "ingest-url-flow.js" });
  return {
    api: context.window.JobBoredDiscovery.ingestUrlFlow,
    elements,
    toasts,
  };
}

/** VM stubs for hoisted auth getters referenced by sliced app.js helpers. */
const ingestAuthVmPreamble = `
function getAccessToken() {
  return typeof accessToken === "undefined" ? "" : accessToken;
}
function getTokenExpiresAt() {
  return tokenExpiresAt;
}
`;

/** VM stubs for discovery-status-handoff.js host/runTracker accessors. */
const statusHandoffVmPreamble = `
function host() {
  return {
    normalizeDiscoveryWebhookIdentity(raw) {
      return raw != null ? String(raw).trim() : "";
    },
    isLocalWebhookCandidateUrl() {
      return true;
    },
  };
}
function runTracker() {
  return {};
}
function configCore() {
  return {};
}
`;

describe("Add job from URL endpoint resolution", () => {
  it("submits ingest through the same resolved discovery endpoint used by runs", () => {
    const submitSource = readIngestAsyncFunctionSource(
      "handleIngestUrlSubmit",
      "\n}\n\nfunction getIngestManualModalEls",
    );

    assert.match(
      submitSource,
      /const webhook = await h\("resolveDiscoveryRunWebhookUrl"\);/,
      "ingest should use the discovery transport resolver before building /ingest-url",
    );
    assert.doesNotMatch(
      submitSource,
      /const webhook = getDiscoveryWebhookUrl\(\);/,
      "ingest must not depend only on the saved Settings webhook URL",
    );
    assert.match(submitSource, /resolveIngestUrlEndpoint\(webhook\)/);
  });

  it("keeps the run resolver wired to bootstrap, readiness, relay, tunnel, and local fallbacks", () => {
    assert.match(
      appCompatJs,
      /async function resolveDiscoveryRunWebhookUrl\(/,
      "app-compat.js must keep a thin resolveDiscoveryRunWebhookUrl wrapper",
    );
    const resolverSource = readAsyncFunctionSource(
      "resolveDiscoveryRunWebhookUrl",
      "\n}\n\n/** Notify automation",
      runOrchJs,
    );
    const candidatesSource = readFunctionSource(
      "getDiscoveryRunWebhookUrlCandidates",
      "\n}\n\nasync function resolveDiscoveryRunWebhookUrl",
      runOrchJs,
    );

    assert.match(resolverSource, /h\("hydrateDiscoveryTransportSetupFromLocalBootstrap"\)/);
    assert.match(
      resolverSource,
      /h\("refreshDiscoveryReadinessSnapshot", \{\s*force:\s*true,\s*rerender:\s*false,\s*\}\)/,
    );
    assert.match(candidatesSource, /state\.relayTargetUrl/);
    assert.match(candidatesSource, /snapshot_tunnel_target/);
    assert.match(candidatesSource, /h\("getCloudflareRelayTargetInfo"\)/);
    assert.match(candidatesSource, /h\("buildDiscoveryTunnelTargetUrl"/);
    assert.match(candidatesSource, /source:\s*"configured"/);
    assert.match(candidatesSource, /source:\s*"snapshot_local"/);
    assert.match(candidatesSource, /source:\s*"transport_local"/);
    assert.match(candidatesSource, /allowDirectLocal \? state\.localWebhookUrl : ""/);
    assert.match(candidatesSource, /allowDirectLocal \? transport\.localWebhookUrl : ""/);
    assert.match(resolverSource, /scoreDiscoveryRunWebhookCandidates\(/);
    assert.match(resolverSource, /h\("writeDiscoveryTransportSetupState"/);
    assert.doesNotMatch(
      resolverSource,
      /if \(configured\) return configured/,
      "resolver must score candidates instead of blindly trusting the saved URL first",
    );
  });

  it("rejects local-only candidates on hosted dashboards and boosts hosted worker URLs", () => {
    const probeSource = readFunctionSource(
      "getDiscoveryRunWebhookCandidateProbe",
      "\n}\n\nasync function scoreDiscoveryRunWebhookCandidates",
      runOrchJs,
    );

    assert.match(probeSource, /local_only_on_hosted_dashboard/);
    assert.match(probeSource, /h\("isLikelyCloudflareWorkerUrl", url\)/);
    assert.match(probeSource, /h\("isLikelyNgrokWebhookUrl", url\)/);
    assert.match(probeSource, /h\("sameDiscoveryUrlOrigin", url, state\.tunnelPublicUrl\)/);
    assert.match(probeSource, /!h\("isLocalDashboardOrigin"\) && \(worker \|\| hostedHttps\)/);
    assert.match(probesJs, /const isHostedSavedEndpoint =/);
    assert.match(
      probesJs,
      /!isHostedSavedEndpoint &&\s*\(hasLocalPathSignals/,
      "hosted saved Worker URLs must not be classified as broken local setup on GitHub Pages",
    );
  });

  it("sends the fresh browser Google access token to /ingest-url when available", () => {
    const submitSource = readIngestAsyncFunctionSource(
      "handleIngestUrlSubmit",
      "\n}\n\nfunction getIngestManualModalEls",
    );

    assert.match(
      submitSource,
      /await h\("getFreshDiscoveryRequestGoogleAccessToken",/,
    );
    assert.match(submitSource, /body\.googleAccessToken = dashboardGoogleAccessToken/);
  });

  it("offers manual fallback with the failed URL prefilled after extraction failures", () => {
    const { api, elements, toasts } = loadIngestManualFallbackHarness();
    const url = "https://wellfound.com/jobs/3739503-2-digital-ai-strategy-lead";

    const result = api.handleIngestUrlResponse(
      {
        ok: false,
        reason: "blocked_aggregator",
        host: "wellfound.com",
        hint: "Wellfound did not expose a complete posting.",
      },
      url,
    );

    assert.equal(result.reason, "blocked_aggregator");
    assert.equal(toasts.length, 1);
    assert.equal(toasts[0][1], "warning");
    assert.equal(toasts[0][2], true);
    assert.equal(toasts[0][3]?.label, "Add manually");

    toasts[0][3].onClick();

    assert.equal(elements.ingestManualForm.resetCalled, true);
    assert.equal(elements.ingestManualUrl.value, url);
    assert.equal(elements.ingestManualModal.style.display, "flex");
    assert.match(elements.ingestManualModalExplain.textContent, /Wellfound did not expose/);
    assert.equal(elements.ingestManualTitle.focusCalled, true);
  });

  it("retries Add URL with a forced fresh Google token after Sheets auth failures", () => {
    const tokenSource = readAsyncFunctionSource(
      "getFreshDiscoveryRequestGoogleAccessToken",
      "\n}\n\nfunction showDiscoveryVerificationToast",
      readinessJs,
    );
    const authFailureSource = readFunctionSource(
      "isIngestSheetAuthFailure",
      "\n}\n\n// Discovery verification-state",
    );
    const submitSource = readIngestAsyncFunctionSource(
      "handleIngestUrlSubmit",
      "\n}\n\nfunction getIngestManualModalEls",
    );

    assert.match(tokenSource, /options && options\.force === true/);
    assert.match(tokenSource, /refreshAccessTokenSilently/);
    assert.match(authFailureSource, /UNAUTHENTICATED/);
    assert.match(authFailureSource, /invalid authentication credentials/);
    assert.doesNotMatch(authFailureSource, /\\b401\\b/);
    assert.match(submitSource, /h\("isIngestSheetAuthFailure", data\)/);
    assert.match(submitSource, /!res\.ok && h\("isIngestSheetAuthFailure", data\)/);
    assert.match(submitSource, /return data;/);
    assert.match(submitSource, /forceGoogleTokenRefresh:\s*true/);
    assert.match(submitSource, /h\("clearPersistedRuntimeOAuthSession"\)/);
    assert.match(submitSource, /h\("showSheetAccessGate", "signin"\)/);
  });

  it("behaviorally polls async Add URL status until the final ingest result is ready", async () => {
    const sources = [
      completeFunction(
        readStatusFunctionSource(
          "buildRunStatusUrl",
          "\n}\n\nfunction canSynthesizeRunStatusPath",
        ),
      ),
      completeFunction(
        readStatusFunctionSource(
          "canSynthesizeRunStatusPath",
          "\n}\n\nfunction resolveAcceptedRunStatusPath",
        ),
      ),
      completeFunction(
        readStatusFunctionSource(
          "resolveAcceptedRunStatusPath",
          "\n}\n\nfunction isLikelyNgrokUrl",
        ),
      ),
      completeFunction(
        readStatusFunctionSource(
          "isLikelyNgrokUrl",
          "\n}\n\nfunction getDiscoveryStatusPollingWebhookUrl",
        ),
      ),
      completeFunction(
        readStatusFunctionSource(
          "buildDiscoveryStatusPollHeaders",
          "\n}\n\n/**\n * Fetch and process",
        ),
      ),
    ].join("\n");
    const requests = [];
    const context = vm.createContext({
      console,
      AbortController,
      setTimeout,
      clearTimeout,
      Date,
      URL,
      MAX_POLL_ERRORS: 3,
      INGEST_URL_TIMEOUT_MS: 5_000,
      INGEST_URL_ASYNC_TIMEOUT_MS: 2_000,
      INGEST_URL_ASYNC_POLL_MS: 1,
      accessToken: "browser-token",
      tokenExpiresAt: Date.now() + 3_600_000,
      async resolveDiscoveryRunWebhookUrl() {
        return "http://127.0.0.1:8644/webhook";
      },
      resolveIngestUrlEndpoint() {
        return "http://127.0.0.1:8644/ingest-url";
      },
      getSheetId() {
        return "sheet_123";
      },
      getDiscoveryWebhookSecret() {
        return "webhook_secret";
      },
      clearPersistedRuntimeOAuthSession() {},
      getOAuthClientId() {
        return "client_123";
      },
      showSheetAccessGate() {},
      async getFreshDiscoveryRequestGoogleAccessToken() {
        return "browser-token";
      },
      isIngestSheetAuthFailure: () => false,
      refreshDiscoveryWebhookSecretFromBootstrapForEndpoint: async () => null,
      showToast() {},
      getDiscoveryWizardVerifyApi() {
        return null;
      },
      createIngestVerificationError(_classification, _endpoint, message) {
        return new Error(message);
      },
      isFetchNetworkError() {
        return false;
      },
      reportIngestProgress() {},
      fetch: async (endpoint, init = {}) => {
        requests.push({ endpoint, init });
        if (String(init.method || "GET").toUpperCase() === "GET") {
          assert.equal(
            endpoint,
            "http://127.0.0.1:8644/runs/ingest_async_ui",
          );
          return jsonResponse({
            ok: true,
            status: 200,
            body: {
              runId: "ingest_async_ui",
              status: "completed",
              terminal: true,
              ingestResult: {
                ok: true,
                strategy: "browser_use_cloud",
                appended: true,
                lead: { title: "Role", company: "Company" },
              },
            },
          });
        }
        return jsonResponse({
          ok: true,
          status: 202,
          body: {
            ok: true,
            kind: "accepted_async",
            runId: "ingest_async_ui",
            message: "accepted",
            statusPath: "/runs/ingest_async_ui",
            pollAfterMs: 1,
          },
        });
      },
    });

    const statusAndAppSources = statusHandoffVmPreamble + sources;

    context.__ingestHost = context;
    vm.runInContext(buildIngestSubmitVmScript(statusAndAppSources, true), context, {
      filename: "app.js#ingest-url-async-submit",
    });
    const result = await vm.runInContext(
      'handleIngestUrlSubmit("https://www.linkedin.com/jobs/view/123")',
      context,
    );

    assert.equal(result.ok, true);
    assert.equal(result.strategy, "browser_use_cloud");
    assert.equal(requests.length, 2);
    const postBody = JSON.parse(String(requests[0].init.body || "{}"));
    assert.equal(postBody.async, true);
    assert.equal(postBody.googleAccessToken, "browser-token");
  });

  it("behaviorally retries the worker POST with a fresh token after a Sheets auth body", async () => {
    const sources = [
      completeFunction(
        readFunctionSource(
          "isIngestSheetAuthFailure",
          "\n}\n\n// Discovery verification-state",
        ),
      ),
    ].join("\n");
    const fetchBodies = [];
    const calls = { refresh: 0, gate: [] };
    const context = vm.createContext({
      console,
      AbortController,
      setTimeout,
      clearTimeout,
      INGEST_URL_TIMEOUT_MS: 5_000,
      accessToken: "stale-token",
      tokenExpiresAt: Date.now() + 3_600_000,
      async resolveDiscoveryRunWebhookUrl() {
        return "http://127.0.0.1:8644/webhook";
      },
      resolveIngestUrlEndpoint() {
        return "http://127.0.0.1:8644/ingest-url";
      },
      getSheetId() {
        return "sheet_123";
      },
      getDiscoveryWebhookSecret() {
        return "webhook_secret";
      },
      async getFreshDiscoveryRequestGoogleAccessToken(options = {}) {
        if (options && options.force === true) {
          await context.refreshAccessTokenSilently();
        }
        return context.accessToken;
      },
      async refreshAccessTokenSilently() {
        calls.refresh += 1;
        context.accessToken = "fresh-token";
        return true;
      },
      clearPersistedRuntimeOAuthSession() {},
      getOAuthClientId() {
        return "client_123";
      },
      showSheetAccessGate(mode) {
        calls.gate.push(mode);
      },
      showToast() {},
      getDiscoveryWizardVerifyApi() {
        return null;
      },
      refreshDiscoveryWebhookSecretFromBootstrapForEndpoint: async () => null,
      createIngestVerificationError(_classification, _endpoint, message) {
        return new Error(message);
      },
      classifyIngestEndpointFailure() {
        return {};
      },
      classifyIngestNetworkFailure() {
        return {};
      },
      isFetchNetworkError() {
        return false;
      },
      fetch: async (_endpoint, init) => {
        fetchBodies.push(JSON.parse(String(init.body || "{}")));
        if (fetchBodies.length === 1) {
          return jsonResponse({
            ok: false,
            status: 500,
            body: {
              ok: false,
              message:
                "Internal error handling ingest-url request. Sheet write failed during append phase: HTTP 401 - UNAUTHENTICATED: Request had invalid authentication credentials.",
            },
          });
        }
        return jsonResponse({
          ok: true,
          status: 200,
          body: {
            ok: true,
            appended: true,
            strategy: "cheerio_dom",
            lead: { title: "Role", company: "Company" },
          },
        });
      },
    });

    context.__ingestHost = context;
    vm.runInContext(buildIngestSubmitVmScript(sources, false), context, {
      filename: "app.js#ingest-url-submit",
    });
    const result = await vm.runInContext(
      'handleIngestUrlSubmit("https://example.com/jobs/123")',
      context,
    );

    assert.equal(result.ok, true);
    assert.equal(fetchBodies.length, 2);
    assert.equal(fetchBodies[0].googleAccessToken, "stale-token");
    assert.equal(fetchBodies[1].googleAccessToken, "fresh-token");
    assert.equal(calls.refresh, 1);
    assert.deepEqual(calls.gate, []);
  });

  it("does not refresh Google auth for plain webhook-secret 401 responses", async () => {
    const sources = [
      completeFunction(
        readFunctionSource(
          "isIngestSheetAuthFailure",
          "\n}\n\n// Discovery verification-state",
        ),
      ),
    ].join("\n");
    const calls = { refresh: 0 };
    const context = vm.createContext({
      console,
      AbortController,
      setTimeout,
      clearTimeout,
      INGEST_URL_TIMEOUT_MS: 5_000,
      accessToken: "current-token",
      tokenExpiresAt: Date.now() + 3_600_000,
      async resolveDiscoveryRunWebhookUrl() {
        return "http://127.0.0.1:8644/webhook";
      },
      resolveIngestUrlEndpoint() {
        return "http://127.0.0.1:8644/ingest-url";
      },
      getSheetId() {
        return "sheet_123";
      },
      getDiscoveryWebhookSecret() {
        return "";
      },
      async refreshAccessTokenSilently() {
        calls.refresh += 1;
        return true;
      },
      clearPersistedRuntimeOAuthSession() {},
      getOAuthClientId() {
        return "client_123";
      },
      showSheetAccessGate() {},
      async getFreshDiscoveryRequestGoogleAccessToken() {
        return "browser-token";
      },
      isIngestSheetAuthFailure: () => false,
      refreshDiscoveryWebhookSecretFromBootstrapForEndpoint: async () => null,
      showToast() {},
      getDiscoveryWizardVerifyApi() {
        return null;
      },
      isFetchNetworkError() {
        return false;
      },
      fetch: async () =>
        jsonResponse({
          ok: false,
          status: 401,
          body: {
            ok: false,
            message: "Unauthorized ingest-url request.",
            auth: { category: "missing_secret" },
          },
        }),
    });

    context.__ingestHost = context;
    vm.runInContext(buildIngestSubmitVmScript(sources, false), context, {
      filename: "app.js#ingest-url-submit",
    });
    await assert.rejects(
      () =>
        vm.runInContext(
          'handleIngestUrlSubmit("https://example.com/jobs/123")',
          context,
        ),
      /The discovery worker needs a webhook secret\.|Unauthorized ingest-url request/,
    );
    assert.equal(calls.refresh, 0);
  });

  it("refreshes and reveals successful Add URL rows after the worker writes", () => {
    const responseSource = readIngestFunctionSource(
      "handleIngestUrlResponse",
      "\n}\n\nfunction setIngestSubmitLoading",
    );
    const refreshSource = readIngestAsyncFunctionSource(
      "refreshPipelineAfterIngest",
      "\n}\n\n// Auto-enrich",
    );
    const revealSource = readIngestFunctionSource(
      "revealPipelineJobByIndex",
      "\n}\n\nfunction createIngestVerificationError",
    );

    assert.match(responseSource, /data\.updated === true \|\| data\.appended === false/);
    assert.match(responseSource, /refreshPipelineAfterIngest\(\{\s*url,\s*data,/);
    assert.match(responseSource, /return settlePostIngestWork\(refresh, data\)/);
    assert.match(responseSource, /return settlePostIngestWork\(enrich, data\)/);
    assert.match(ingestUrlFlowJs, /const POST_INGEST_RESPONSE_WAIT_MS = 12000/);
    assert.match(ingestUrlFlowJs, /Promise\.race\(\[task, timeout\]\)/);
    assert.match(ingestUrlFlowJs, /clearTimeout\(timer\)/);
    assert.match(refreshSource, /await h\("loadAllData"\)/);
    assert.match(refreshSource, /getDuplicatePipelineIndexFromIngest\(url, data\)/);
    assert.match(refreshSource, /revealPipelineJobByIndex\(idx\)/);
    assert.match(revealSource, /clearPipelineRevealFilters\(\)/);
    assert.match(ingestUrlFlowJs, /h\("setCurrentSearch", ""\)/);
    assert.match(ingestUrlFlowJs, /h\("setFavoritesOnly", false\)/);
    assert.match(ingestUrlFlowJs, /\[data-pipeline-search\]/);
  });

  it("promotes inferred employer over JobBored/referral placeholders for URL-only rows", async () => {
    const { api, jobs, updates, url } = loadIngestUrlPromotionHarness();
    api.handleIngestUrlResponse(
      {
        ok: true,
        strategy: "url_only",
        rowNumber: 7,
        lead: { title: "View", company: "JobBored", url },
      },
      url,
    );
    await flushMicrotasks();

    assert.deepEqual(JSON.parse(JSON.stringify(updates)), [
      { range: "Pipeline!B7", value: "Lifecycle Marketing Manager" },
      { range: "Pipeline!C7", value: "Acme Labs" },
      { range: "Pipeline!D7", value: "Remote" },
    ]);
    assert.equal(jobs[0].company, "Acme Labs");
  });

  it("promotes inferred employer when a scraped row used a referral host as company", async () => {
    const { api, jobs, updates, url } = loadIngestUrlPromotionHarness({
      company: "Referrals",
    });

    api.handleIngestUrlResponse(
      {
        ok: true,
        strategy: "cheerio_dom",
        rowNumber: 7,
        lead: { title: "Lifecycle Marketing Manager", company: "Referrals", url },
      },
      url,
    );
    await flushMicrotasks();

    assert.deepEqual(JSON.parse(JSON.stringify(updates)), [
      { range: "Pipeline!B7", value: "Lifecycle Marketing Manager" },
      { range: "Pipeline!C7", value: "Acme Labs" },
      { range: "Pipeline!D7", value: "Remote" },
    ]);
    assert.equal(jobs[0].company, "Acme Labs");
  });

  it("does not replace one placeholder employer with another placeholder inferred value", async () => {
    const { api, jobs, updates, url } = loadIngestUrlPromotionHarness({
      inferredCompany: "Referral",
    });

    api.handleIngestUrlResponse(
      {
        ok: true,
        strategy: "url_only",
        rowNumber: 7,
        lead: { title: "View", company: "JobBored", url },
      },
      url,
    );
    await flushMicrotasks();

    assert.deepEqual(JSON.parse(JSON.stringify(updates)), [
      { range: "Pipeline!B7", value: "Lifecycle Marketing Manager" },
      { range: "Pipeline!D7", value: "Remote" },
    ]);
    assert.equal(jobs[0].company, "JobBored");
  });

  it("does not promote an ATS provider label as the employer for that provider URL", async () => {
    const { api, jobs, updates, url } = loadIngestUrlPromotionHarness({
      url: "https://job-boards.greenhouse.io/acme/jobs/123",
      inferredCompany: "Greenhouse",
    });

    api.handleIngestUrlResponse(
      {
        ok: true,
        strategy: "url_only",
        rowNumber: 7,
        lead: { title: "View", company: "JobBored", url },
      },
      url,
    );
    await flushMicrotasks();

    assert.deepEqual(JSON.parse(JSON.stringify(updates)), [
      { range: "Pipeline!B7", value: "Lifecycle Marketing Manager" },
      { range: "Pipeline!D7", value: "Remote" },
    ]);
    assert.equal(jobs[0].company, "JobBored");
  });

  it("manual entry can append directly to Pipeline when no webhook exists", () => {
    const submitSource = readIngestAsyncFunctionSource(
      "handleIngestUrlSubmit",
      "\n}\n\nfunction getIngestManualModalEls",
    );
    const appendSource = readIngestAsyncFunctionSource(
      "appendManualPipelineRowDirect",
      "\n}\n\nasync function ingestJobUrl",
    );

    assert.match(submitSource, /return appendManualPipelineRowDirect\(\{ \.\.\.manualOverride, url \}\)/);
    assert.match(appendSource, /h\("sheetsValuesAppend", "Pipeline!A:T", \[row\]\)/);
    assert.match(appendSource, /"Manual"/);
    assert.match(appendSource, /"New"/);
    assert.match(indexHtml, /for="ingestManualUrl">Job URL \(optional\)<\/label>/);
    assert.doesNotMatch(
      indexHtml,
      /id="ingestManualUrl"[\s\S]{0,160}\breadonly\b/,
      "manual direct entry must not require a URL-only readonly field",
    );
  });

  it("classifies ingest transport failures through the discovery verifier", () => {
    const submitSource = readIngestAsyncFunctionSource(
      "handleIngestUrlSubmit",
      "\n}\n\nfunction getIngestManualModalEls",
    );

    assert.match(submitSource, /classifyIngestEndpointFailure\(/);
    assert.match(submitSource, /classifyIngestNetworkFailure\(/);
    assert.match(ingestUrlFlowJs, /showIngestDiscoveryError\(err\)/);
    assert.match(ingestUrlFlowJs, /verifyApi\.summarizeResult\(/);
  });

  it("duplicate Add URL responses hide row 0 and try to focus the existing Pipeline card", () => {
    const responseSource = readIngestFunctionSource(
      "handleIngestUrlResponse",
      "\n}\n\nfunction setIngestSubmitLoading",
    );

    assert.match(responseSource, /row >= 2/);
    assert.match(responseSource, /getDuplicatePipelineIndexFromIngest\(url, data\)/);
    assert.match(responseSource, /focusPipelineJobByIndex\(existingIndex\)/);
    assert.match(ingestUrlFlowJs, /focusPipelineJobByIndex/);
  });
});
