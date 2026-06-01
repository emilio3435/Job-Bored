import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { readIndexHtml } from "../scripts/lib/expand-index-includes.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const appJs = readFileSync(join(repoRoot, "app.js"), "utf8");
const probesJs = readFileSync(join(repoRoot, "discovery-wizard-probes.js"), "utf8");
const indexHtml = readIndexHtml(repoRoot);

function readFunctionSource(name, endMarker) {
  const start = appJs.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} must exist`);
  const end = appJs.indexOf(endMarker, start);
  assert.notEqual(end, -1, `${name} body must be readable`);
  return appJs.slice(start, end);
}

function readAsyncFunctionSource(name, endMarker) {
  const start = appJs.indexOf(`async function ${name}(`);
  assert.notEqual(start, -1, `${name} must exist`);
  const end = appJs.indexOf(endMarker, start);
  assert.notEqual(end, -1, `${name} body must be readable`);
  return appJs.slice(start, end);
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

/** VM stubs for hoisted auth getters referenced by sliced app.js helpers. */
const ingestAuthVmPreamble = `
function getAccessToken() {
  return typeof accessToken === "undefined" ? "" : accessToken;
}
function getTokenExpiresAt() {
  return tokenExpiresAt;
}
`;

describe("Add job from URL endpoint resolution", () => {
  it("submits ingest through the same resolved discovery endpoint used by runs", () => {
    const submitSource = readAsyncFunctionSource(
      "handleIngestUrlSubmit",
      "\n}\n\nfunction getIngestManualModalEls",
    );

    assert.match(
      submitSource,
      /const webhook = await resolveDiscoveryRunWebhookUrl\(\);/,
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
    const resolverSource = readAsyncFunctionSource(
      "resolveDiscoveryRunWebhookUrl",
      "\n}\n\n/** Notify automation",
    );
    const candidatesSource = readFunctionSource(
      "getDiscoveryRunWebhookUrlCandidates",
      "\n}\n\nasync function resolveDiscoveryRunWebhookUrl",
    );

    assert.match(resolverSource, /hydrateDiscoveryTransportSetupFromLocalBootstrap\(\)/);
    assert.match(
      resolverSource,
      /refreshDiscoveryReadinessSnapshot\(\{\s*force:\s*true,\s*rerender:\s*false,\s*\}\)/,
    );
    assert.match(candidatesSource, /state\.relayTargetUrl/);
    assert.match(candidatesSource, /snapshot_tunnel_target/);
    assert.match(candidatesSource, /getCloudflareRelayTargetInfo\(\)/);
    assert.match(candidatesSource, /buildDiscoveryTunnelTargetUrl\(/);
    assert.match(candidatesSource, /source:\s*"configured"/);
    assert.match(candidatesSource, /source:\s*"snapshot_local"/);
    assert.match(candidatesSource, /source:\s*"transport_local"/);
    assert.match(candidatesSource, /allowDirectLocal \? state\.localWebhookUrl : ""/);
    assert.match(candidatesSource, /allowDirectLocal \? transport\.localWebhookUrl : ""/);
    assert.match(resolverSource, /scoreDiscoveryRunWebhookCandidates\(/);
    assert.match(resolverSource, /writeDiscoveryTransportSetupState\(/);
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
    );

    assert.match(probeSource, /local_only_on_hosted_dashboard/);
    assert.match(probeSource, /isLikelyCloudflareWorkerUrl\(url\)/);
    assert.match(probeSource, /isLikelyNgrokWebhookUrl\(url\)/);
    assert.match(probeSource, /sameDiscoveryUrlOrigin\(url, state\.tunnelPublicUrl\)/);
    assert.match(probeSource, /!isLocalDashboardOrigin\(\) && \(worker \|\| hostedHttps\)/);
    assert.match(probesJs, /const isHostedSavedEndpoint =/);
    assert.match(
      probesJs,
      /!isHostedSavedEndpoint &&\s*\(hasLocalPathSignals/,
      "hosted saved Worker URLs must not be classified as broken local setup on GitHub Pages",
    );
  });

  it("sends the fresh browser Google access token to /ingest-url when available", () => {
    const submitSource = readAsyncFunctionSource(
      "handleIngestUrlSubmit",
      "\n}\n\nfunction getIngestManualModalEls",
    );

    assert.match(submitSource, /await getFreshDiscoveryRequestGoogleAccessToken\(/);
    assert.match(submitSource, /body\.googleAccessToken = dashboardGoogleAccessToken/);
  });

  it("retries Add URL with a forced fresh Google token after Sheets auth failures", () => {
    const tokenSource = readAsyncFunctionSource(
      "getFreshDiscoveryRequestGoogleAccessToken",
      "\n}\n\nfunction isIngestSheetAuthFailure",
    );
    const authFailureSource = readFunctionSource(
      "isIngestSheetAuthFailure",
      "\n}\n\nfunction getDiscoveryEngineStateFromVerificationResult",
    );
    const submitSource = readAsyncFunctionSource(
      "handleIngestUrlSubmit",
      "\n}\n\nfunction getIngestManualModalEls",
    );

    assert.match(tokenSource, /options && options\.force === true/);
    assert.match(tokenSource, /refreshAccessTokenSilently\(\)/);
    assert.match(authFailureSource, /UNAUTHENTICATED/);
    assert.match(authFailureSource, /invalid authentication credentials/);
    assert.doesNotMatch(authFailureSource, /\\b401\\b/);
    assert.match(submitSource, /isIngestSheetAuthFailure\(data\)/);
    assert.match(submitSource, /!res\.ok && isIngestSheetAuthFailure\(data\)/);
    assert.match(submitSource, /return data;/);
    assert.match(submitSource, /forceGoogleTokenRefresh:\s*true/);
    assert.match(submitSource, /clearPersistedRuntimeOAuthSession\(\)/);
    assert.match(submitSource, /showSheetAccessGate\("signin"\)/);
  });

  it("behaviorally polls async Add URL status until the final ingest result is ready", async () => {
    const sources = [
      completeFunction(
        readFunctionSource(
          "buildRunStatusUrl",
          "\n}\n\nfunction canSynthesizeRunStatusPath",
        ),
      ),
      completeFunction(
        readFunctionSource(
          "canSynthesizeRunStatusPath",
          "\n}\n\nfunction resolveAcceptedRunStatusPath",
        ),
      ),
      completeFunction(
        readFunctionSource(
          "resolveAcceptedRunStatusPath",
          "\n}\n\nfunction isLikelyNgrokUrl",
        ),
      ),
      completeFunction(
        readFunctionSource(
          "isLikelyNgrokUrl",
          "\n}\n\nfunction getDiscoveryStatusPollingWebhookUrl",
        ),
      ),
      completeFunction(
        readFunctionSource(
          "buildDiscoveryStatusPollHeaders",
          "\n}\n\n/**\n * Fetch and process",
        ),
      ),
      completeFunction(
        readFunctionSource(
          "getDiscoveryRequestGoogleAccessToken",
          "\n}\n\nasync function getFreshDiscoveryRequestGoogleAccessToken",
        ),
      ),
      completeFunction(
        readAsyncFunctionSource(
          "getFreshDiscoveryRequestGoogleAccessToken",
          "\n}\n\nfunction isIngestSheetAuthFailure",
        ),
      ),
      completeFunction(
        readFunctionSource(
          "isIngestSheetAuthFailure",
          "\n}\n\nfunction getDiscoveryEngineStateFromVerificationResult",
        ),
      ),
      completeFunction(
        readAsyncFunctionSource(
          "handleIngestUrlSubmit",
          "\n}\n\nfunction getIngestManualModalEls",
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

    vm.runInContext(ingestAuthVmPreamble + sources, context, {
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
          "getDiscoveryRequestGoogleAccessToken",
          "\n}\n\nasync function getFreshDiscoveryRequestGoogleAccessToken",
        ),
      ),
      completeFunction(
        readAsyncFunctionSource(
          "getFreshDiscoveryRequestGoogleAccessToken",
          "\n}\n\nfunction isIngestSheetAuthFailure",
        ),
      ),
      completeFunction(
        readFunctionSource(
          "isIngestSheetAuthFailure",
          "\n}\n\nfunction getDiscoveryEngineStateFromVerificationResult",
        ),
      ),
      completeFunction(
        readAsyncFunctionSource(
          "handleIngestUrlSubmit",
          "\n}\n\nfunction getIngestManualModalEls",
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

    vm.runInContext(ingestAuthVmPreamble + sources, context, {
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
          "getDiscoveryRequestGoogleAccessToken",
          "\n}\n\nasync function getFreshDiscoveryRequestGoogleAccessToken",
        ),
      ),
      completeFunction(
        readAsyncFunctionSource(
          "getFreshDiscoveryRequestGoogleAccessToken",
          "\n}\n\nfunction isIngestSheetAuthFailure",
        ),
      ),
      completeFunction(
        readFunctionSource(
          "isIngestSheetAuthFailure",
          "\n}\n\nfunction getDiscoveryEngineStateFromVerificationResult",
        ),
      ),
      completeFunction(
        readAsyncFunctionSource(
          "handleIngestUrlSubmit",
          "\n}\n\nfunction getIngestManualModalEls",
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
      createIngestVerificationError(_classification, _endpoint, message) {
        const err = new Error(message);
        err.discoveryVerificationResult = true;
        return err;
      },
      classifyIngestEndpointFailure() {
        return { kind: "auth_required" };
      },
      classifyIngestNetworkFailure() {
        return {};
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

    vm.runInContext(ingestAuthVmPreamble + sources, context, {
      filename: "app.js#ingest-url-submit",
    });
    await assert.rejects(
      () =>
        vm.runInContext(
          'handleIngestUrlSubmit("https://example.com/jobs/123")',
          context,
        ),
      /Unauthorized ingest-url request/,
    );
    assert.equal(calls.refresh, 0);
  });

  it("refreshes and reveals successful Add URL rows after the worker writes", () => {
    const responseSource = readFunctionSource(
      "handleIngestUrlResponse",
      "\n}\n\nfunction setIngestSubmitLoading",
    );
    const refreshSource = readAsyncFunctionSource(
      "refreshPipelineAfterIngest",
      "\n}\n\n// Auto-enrich",
    );
    const revealSource = readFunctionSource(
      "revealPipelineJobByIndex",
      "\n}\n\nfunction createIngestVerificationError",
    );

    assert.match(responseSource, /data\.updated === true \|\| data\.appended === false/);
    assert.match(responseSource, /refreshPipelineAfterIngest\(\{\s*url,\s*data,/);
    assert.match(responseSource, /return refresh\.then\(\(\) => data\)/);
    assert.match(refreshSource, /await loadAllData\(\)/);
    assert.match(refreshSource, /getDuplicatePipelineIndexFromIngest\(url, data\)/);
    assert.match(refreshSource, /revealPipelineJobByIndex\(idx\)/);
    assert.match(revealSource, /clearPipelineRevealFilters\(\)/);
    assert.match(appJs, /currentSearch = ""/);
    assert.match(appJs, /favoritesOnly = false/);
    assert.match(appJs, /\[data-pipeline-search\]/);
  });

  it("manual entry can append directly to Pipeline when no webhook exists", () => {
    const submitSource = readAsyncFunctionSource(
      "handleIngestUrlSubmit",
      "\n}\n\nfunction getIngestManualModalEls",
    );
    const appendSource = readAsyncFunctionSource(
      "appendManualPipelineRowDirect",
      "\n}\n\nasync function ingestJobUrl",
    );

    assert.match(submitSource, /return appendManualPipelineRowDirect\(\{ \.\.\.manualOverride, url \}\)/);
    assert.match(appendSource, /sheetsValuesAppend\("Pipeline!A:T", \[row\]\)/);
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
    const submitSource = readAsyncFunctionSource(
      "handleIngestUrlSubmit",
      "\n}\n\nfunction getIngestManualModalEls",
    );

    assert.match(submitSource, /classifyIngestEndpointFailure\(/);
    assert.match(submitSource, /classifyIngestNetworkFailure\(/);
    assert.match(appJs, /showIngestDiscoveryError\(err\)/);
    assert.match(appJs, /verifyApi\.summarizeResult\(/);
  });

  it("duplicate Add URL responses hide row 0 and try to focus the existing Pipeline card", () => {
    const responseSource = readFunctionSource(
      "handleIngestUrlResponse",
      "\n}\n\nfunction setIngestSubmitLoading",
    );

    assert.match(responseSource, /row >= 2/);
    assert.match(responseSource, /getDuplicatePipelineIndexFromIngest\(url, data\)/);
    assert.match(responseSource, /focusPipelineJobByIndex\(existingIndex\)/);
    assert.match(appJs, /focusJobByIndex|focusPipelineJobByIndex/);
  });
});
