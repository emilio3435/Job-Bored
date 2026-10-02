import assert from "node:assert/strict";
import { describe, it } from "node:test";
import vm from "node:vm";

import {
  createClock,
  createControlledFetch,
  flush,
  jsonResponse,
  loadDiscoveryTab,
  readRepoFile,
} from "./holes-disco-harness.mjs";

/* HOLES DISCO — triggerDiscoveryRun: single-flight, honest results, one
   permission prompt per click, and no duplicate run after a slow dispatch. */

const ACCEPTED = (runId, statusPath = `/runs/${runId}`) => ({
  ok: true,
  kind: "accepted_async",
  engineState: "unverified",
  runId,
  ...(statusPath ? { statusPath } : {}),
  pollAfterMs: 2000,
});

/** Like the app's normalizer: a real http(s) URL or "". */
function normalizeUrl(raw) {
  if (typeof raw !== "string" || !raw.trim()) return "";
  try {
    const url = new URL(raw.trim());
    return /^https?:$/.test(url.protocol) ? url.toString() : "";
  } catch (_) {
    return "";
  }
}

/**
 * Wire the orchestration host. `verify` answers the dispatch POST (the
 * network boundary); everything else is a quiet stand-in for the app.
 */
function setupTrigger(tab, options = {}) {
  const dispatches = [];
  const engineWrites = [];
  const setupRequests = [];
  let payloadSeq = 0;
  const verify =
    options.verify || (async (_hook, payload) => ACCEPTED(`run_${payload.variationKey}`));
  tab.orchestration.host = {
    isLocalDashboardOrigin: () => !!options.local,
    hydrateDiscoveryTransportSetupFromLocalBootstrap: async () => {},
    getDiscoveryReadinessSnapshot: () => ({}),
    refreshDiscoveryReadinessSnapshot: async () => ({}),
    getDiscoveryTransportSetupState: () => ({}),
    getCloudflareRelayTargetInfo: () => null,
    buildDiscoveryTunnelTargetUrl: () => "",
    getDiscoveryWebhookUrl: () => (options.noUrl ? "" : tab.webhookUrl),
    normalizeDiscoveryWebhookIdentity: normalizeUrl,
    getDiscoveryWizardVerifyApi: () => null,
    isLikelyCloudflareWorkerUrl: () => false,
    isLikelyAppsScriptWebAppUrl: () => false,
    isLikelyNgrokWebhookUrl: () => false,
    sameDiscoveryUrlOrigin: () => false,
    writeDiscoveryTransportSetupState: () => {},
    setDiscoveryWizardMessage: () => {},
    showToast: (message, tone, sticky, action) =>
      tab.toasts.push({ message: String(message), tone, sticky: !!sticky, action }),
    warnDiscoverySourceReadinessBeforeRun: async () => ({ required: [], optional: [] }),
    requestDiscoverySetup: async (o) => {
      setupRequests.push(o);
      return {};
    },
    buildDiscoveryWebhookPayload: async (_sheetId, o) => {
      payloadSeq += 1;
      return {
        event: "command-center.discovery",
        schemaVersion: 1,
        sheetId: "sheet-1",
        trigger: (o && o.trigger) || "manual",
        variationKey: `vk${payloadSeq}`,
        requestedAt: new tab.ctx.Date().toISOString(),
        discoveryProfile: { targetRoles: "Staff Engineer" },
      };
    },
    getSHEET_ID: () => "sheet-1",
    verifyDiscoveryWebhookWithSharedModel: async (hook, payload, o) => {
      dispatches.push({ hook, payload, options: o });
      return verify(hook, payload, o);
    },
    getDiscoveryEngineStateFromVerificationResult: (result) =>
      result && result.ok ? result.engineState || "unverified" : "",
    recordDiscoveryEngineState: async (url, state, source) => {
      engineWrites.push({ url, state, source });
    },
    showDiscoveryVerificationToast: (result) =>
      tab.toasts.push({ message: String(result.message || result.kind), tone: "info" }),
    handleAppsScriptBrowserCorsFailure: async () => false,
    ...(options.host || {}),
  };
  return { dispatches, engineWrites, setupRequests };
}

describe("D3 · triggerDiscoveryRun is single-flight", () => {
  it("answers run_active for a second click while the first is still dispatching", async () => {
    const tab = loadDiscoveryTab();
    let release;
    const { dispatches } = setupTrigger(tab, {
      verify: () =>
        new Promise((resolve) => {
          release = () => resolve(ACCEPTED("run_one"));
        }),
    });
    const first = tab.orchestration.triggerDiscoveryRun({ trigger: "manual" });
    await flush();
    const second = await tab.orchestration.triggerDiscoveryRun({ trigger: "manual" });
    assert.deepEqual({ ok: second.ok, reason: second.reason }, { ok: false, reason: "run_active" });
    release();
    const firstResult = await first;
    assert.equal(firstResult.ok, true);
    assert.equal(firstResult.runId, "run_one");
    assert.equal(dispatches.length, 1, "exactly one dispatch reached the worker");
  });

  it("answers run_active while the tracker is watching a run, naming that run", async () => {
    const tab = loadDiscoveryTab();
    const { dispatches } = setupTrigger(tab);
    const started = await tab.orchestration.triggerDiscoveryRun({ trigger: "manual" });
    assert.equal(started.ok, true);
    const again = await tab.orchestration.triggerDiscoveryRun({ trigger: "manual" });
    assert.equal(again.ok, false);
    assert.equal(again.reason, "run_active");
    assert.equal(again.runId, started.runId);
    assert.equal(dispatches.length, 1);
    assert.ok(
      tab.toasts.some((t) => /already/i.test(t.message)),
      "a manual click is told a run is already going",
    );
  });

  it("lets a new run start once the old one has settled", async () => {
    const tab = loadDiscoveryTab();
    const { dispatches } = setupTrigger(tab);
    await tab.orchestration.triggerDiscoveryRun({ trigger: "manual" });
    tab.tracker.markStatusConnectionLost("Lost the status connection after multiple attempts.");
    const next = await tab.orchestration.triggerDiscoveryRun({ trigger: "manual" });
    assert.equal(next.ok, true);
    assert.equal(dispatches.length, 2);
  });

  it("releases the guard when the dispatch throws", async () => {
    const tab = loadDiscoveryTab();
    let calls = 0;
    setupTrigger(tab, {
      verify: async (_hook, payload) => {
        calls += 1;
        if (calls === 1) throw new Error("boom");
        return ACCEPTED(`run_${payload.variationKey}`);
      },
    });
    const first = await tab.orchestration.triggerDiscoveryRun({ trigger: "manual" });
    assert.equal(first.ok, false);
    const second = await tab.orchestration.triggerDiscoveryRun({ trigger: "manual" });
    assert.equal(second.ok, true);
  });

  it("passes opts through untouched (HUNT adds opts.hunt later)", async () => {
    const tab = loadDiscoveryTab();
    const seen = [];
    setupTrigger(tab, {
      host: {
        buildDiscoveryWebhookPayload: async (_s, o) => {
          seen.push(o);
          return {
            sheetId: "sheet-1",
            variationKey: "vk-h",
            requestedAt: new tab.ctx.Date().toISOString(),
            discoveryProfile: { targetRoles: "Staff Engineer" },
          };
        },
      },
    });
    const result = await tab.orchestration.triggerDiscoveryRun({ trigger: "manual" });
    assert.equal(result.ok, true);
    assert.equal(seen[0].trigger, "manual");
  });
});

describe("D8 · a stub endpoint is not a started run", () => {
  it("returns ok:false with reason stub_only even when the stub answers 200", async () => {
    const tab = loadDiscoveryTab();
    setupTrigger(tab, {
      verify: async () => ({
        ok: true,
        kind: "stub_only",
        engineState: "stub_only",
        message: "Stub received the request — wiring only.",
      }),
    });
    const result = await tab.orchestration.triggerDiscoveryRun({ trigger: "onboarding_payoff" });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "stub_only");
    assert.equal(tab.tracker.getState().status, "idle");
  });
});

describe("D9 · the board refreshes after runs the browser can't watch", () => {
  it("reloads the board right after a synchronous run", async () => {
    const tab = loadDiscoveryTab();
    setupTrigger(tab, {
      verify: async () => ({
        ok: true,
        kind: "connected_ok",
        engineState: "connected",
        message: "Discovery started — new rows should appear shortly.",
      }),
    });
    const result = await tab.orchestration.triggerDiscoveryRun({ trigger: "manual" });
    assert.equal(result.ok, true);
    await flush();
    assert.equal(tab.loads.length, 1, "board reloaded without waiting for the 5-minute poll");
  });

  it("reloads the board on a short schedule after an untracked async run", async () => {
    const tab = loadDiscoveryTab();
    setupTrigger(tab, { verify: async () => ACCEPTED("run_u", "") });
    const result = await tab.orchestration.triggerDiscoveryRun({ trigger: "manual" });
    assert.equal(result.ok, true);
    assert.equal(tab.tracker.getState().statusUnavailable, true);
    assert.equal(tab.loads.length, 0);
    await tab.clock.advance(60 * 1000);
    assert.equal(tab.loads.length, 1);
    await tab.clock.advance(4 * 60 * 1000);
    assert.equal(tab.loads.length, 2);
  });
});

describe("D11 · one click asks permission to change this computer at most once", () => {
  it("does not ask twice when the first local setup still leaves no endpoint", async () => {
    const asked = [];
    const fetchImpl = async (url) => {
      if (String(url).includes("/__proxy/discovery-state")) {
        return jsonResponse(200, { ok: true, recommendation: "auto_recoverable" });
      }
      if (String(url).includes("/__proxy/fix-setup")) return jsonResponse(200, { ok: true });
      return jsonResponse(404, {});
    };
    const tab = loadDiscoveryTab({ fetch: fetchImpl });
    tab.ctx.JobBoredDiscoveryHelpers = {
      confirmHostChange: (opts) => {
        asked.push(opts);
        return true;
      },
    };
    const { setupRequests } = setupTrigger(tab, { local: true, noUrl: true });
    const result = await tab.orchestration.triggerDiscoveryRun({ trigger: "manual" });
    assert.equal(result.reason, "no_url");
    assert.equal(asked.length, 1, `asked ${asked.length} times`);
    assert.equal(setupRequests.length, 1);
  });
});

describe("D14 · a successful async run keeps a connected engine connected", () => {
  it("does not downgrade the saved engine state to unverified", async () => {
    const tab = loadDiscoveryTab({
      files: [
        "discovery-run-tracker.js",
        "discovery-status-handoff.js",
        "discovery-effective-intent.js",
        "discovery-run-orchestration.js",
        "discovery-engine-state.js",
      ],
    });
    const core = {
      DISCOVERY_ENGINE_STATE_NONE: "none",
      DISCOVERY_ENGINE_STATE_STUB_ONLY: "stub_only",
      DISCOVERY_ENGINE_STATE_UNVERIFIED: "unverified",
      DISCOVERY_ENGINE_STATE_CONNECTED: "connected",
      discoveryEngineStateCache: {
        state: "connected",
        webhookUrl: tab.webhookUrl,
        source: "test_webhook",
        lastCheckedAt: "2026-10-01T00:00:00.000Z",
      },
    };
    tab.ctx.JobBoredApp = { configCore: core };
    const engine = tab.discovery.engineState;
    engine.host = {
      refreshDiscoveryUiState() {},
      refreshDiscoveryReadinessSnapshot: async () => ({}),
    };
    setupTrigger(tab, {
      host: {
        getDiscoveryEngineStateFromVerificationResult:
          engine.getDiscoveryEngineStateFromVerificationResult,
        recordDiscoveryEngineState: engine.recordDiscoveryEngineState,
      },
    });
    const result = await tab.orchestration.triggerDiscoveryRun({ trigger: "manual" });
    assert.equal(result.ok, true);
    assert.equal(engine.getSavedDiscoveryEngineStateForUrl(tab.webhookUrl).state, "connected");
  });
});

describe("D16 · a dispatch that times out may have started a run", () => {
  const TIMED_OUT = {
    ok: false,
    kind: "network_error",
    engineState: "none",
    timedOut: true,
    message: "The endpoint didn't answer in time.",
  };

  it("waits a generous 60 s for the dispatch POST", async () => {
    const tab = loadDiscoveryTab();
    const { dispatches } = setupTrigger(tab);
    await tab.orchestration.triggerDiscoveryRun({ trigger: "manual" });
    assert.equal(dispatches[0].options.timeoutMs, 60 * 1000);
  });

  it("says 'may have started — check Runs' instead of a network error", async () => {
    const tab = loadDiscoveryTab();
    setupTrigger(tab, { verify: async () => TIMED_OUT });
    const result = await tab.orchestration.triggerDiscoveryRun({ trigger: "manual" });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "may_have_started");
    const toast = tab.toasts.find((t) => /may have started/i.test(t.message));
    assert.ok(toast, "the user is told the run may have started");
    assert.match(toast.message, /Runs/);
    assert.ok(!tab.toasts.some((t) => /can't reach/i.test(t.message)));
  });

  it("re-sends the same requestedAt and variationKey so the worker dedupes the retry", async () => {
    const tab = loadDiscoveryTab();
    let calls = 0;
    const { dispatches } = setupTrigger(tab, {
      verify: async () => {
        calls += 1;
        return calls === 1 ? TIMED_OUT : ACCEPTED("run_original");
      },
    });
    await tab.orchestration.triggerDiscoveryRun({ trigger: "manual" });
    await tab.clock.advance(5000);
    const retry = await tab.orchestration.triggerDiscoveryRun({ trigger: "manual" });
    assert.equal(retry.ok, true);
    assert.equal(retry.runId, "run_original");
    assert.equal(dispatches.length, 2);
    assert.equal(dispatches[1].payload.variationKey, dispatches[0].payload.variationKey);
    assert.equal(dispatches[1].payload.requestedAt, dispatches[0].payload.requestedAt);

    // Consumed: the run after that is a fresh request.
    tab.tracker.markStatusConnectionLost("gone");
    await tab.orchestration.triggerDiscoveryRun({ trigger: "manual" });
    assert.notEqual(dispatches[2].payload.variationKey, dispatches[0].payload.variationKey);
  });

  it("never persists the Google token while it waits", async () => {
    const tab = loadDiscoveryTab();
    setupTrigger(tab, {
      verify: async () => TIMED_OUT,
      host: {
        buildDiscoveryWebhookPayload: async () => ({
          sheetId: "sheet-1",
          variationKey: "vk-t",
          requestedAt: new tab.ctx.Date().toISOString(),
          googleAccessToken: "ya29.example-token",
          discoveryProfile: { targetRoles: "Staff Engineer" },
        }),
      },
    });
    await tab.orchestration.triggerDiscoveryRun({ trigger: "manual" });
    for (const value of tab.storage.map.values()) {
      assert.ok(!String(value).includes("ya29."), "no token in localStorage");
    }
  });
});

describe("D16 · the verifier tells a slow answer from no answer", () => {
  function loadVerify(fetchImpl) {
    const clock = createClock();
    const ctx = {
      console: { log() {}, info() {}, warn() {}, error() {} },
      URL,
      AbortController,
      fetch: fetchImpl,
      setTimeout: clock.setTimeout,
      clearTimeout: clock.clearTimeout,
      location: { hostname: "app.example.com", port: "" },
    };
    ctx.window = ctx;
    vm.createContext(ctx);
    vm.runInContext(readRepoFile("discovery-wizard-verify.js"), ctx);
    return { verify: ctx.JobBoredDiscoveryWizard.verify, clock };
  }

  it("flags a dispatch that hit its timeout as timedOut, not unreachable", async () => {
    const net = createControlledFetch();
    const { verify, clock } = loadVerify(net.fetch);
    const pending = verify.verifyDiscoveryEndpoint("https://worker.example.com/webhook", {
      context: "run_discovery",
      timeoutMs: 60 * 1000,
      payload: { sheetId: "sheet-1" },
    });
    await flush();
    await clock.advance(60 * 1000);
    const result = await pending;
    assert.equal(net.calls[0].aborted, true);
    assert.equal(result.kind, "network_error");
    assert.equal(result.timedOut, true);
    assert.doesNotMatch(result.message, /Can't reach/);
  });

  it("keeps a real connection failure as can't-reach, without the timeout flag", async () => {
    const { verify } = loadVerify(async () => {
      throw new TypeError("Failed to fetch");
    });
    const result = await verify.verifyDiscoveryEndpoint("https://worker.example.com/webhook", {
      context: "run_discovery",
      payload: { sheetId: "sheet-1" },
    });
    assert.equal(result.kind, "network_error");
    assert.equal(result.timedOut, undefined);
    assert.equal(result.message, "Can't reach the endpoint.");
  });
});
