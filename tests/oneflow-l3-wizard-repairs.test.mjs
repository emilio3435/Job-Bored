/* ============================================================
   ONEFLOW L3 — standalone discovery-wizard repairs (spec §10 Phase 0)
   plus the stage-callback seam B5 drives (spec §5 B5).

   Four claims:

     1. The `entryPoint !== "onboarding"` autodetect bypass is GONE — the
        probe runs for every entry point (spec §5 B5: "including during
        onboarding").
     2. Autodetect's verdict renders inside the wizard instead of a toast
        that the wizard immediately covers.
     3. `Set it up for me` and `Fix setup` have real in-flight states: the
        four stage strings already written in the auto-setup sequence
        reach the screen through the L0 shell's setBusy.
     4. The auto-setup sequence is callable with stage callbacks, so B5
        can drive it and render the four NORMATIVE lines instead.
   ============================================================ */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadWizardUi, makeWizardHost, readRepoFile } from "./oneflow-l3-harness.mjs";

/** vm-realm arrays are not deepStrictEqual to host arrays — re-home them. */
const plain = (list) => [...list];

const discoveryWizardUiJs = readRepoFile("discovery-wizard-ui.js");

// ---------------------------------------------------------------
// A host bridge complete enough to open the wizard.
// ---------------------------------------------------------------

function makeOpenEnv({ autodetect, shellApi } = {}) {
  const { window, ui } = loadWizardUi();
  const calls = { toasts: [], runtimes: [], autodetect: 0 };
  let runtime = {
    entryPoint: "manual",
    snapshot: {},
    state: { flow: "external_endpoint", currentStep: "existing_endpoint", completedSteps: [] },
    activeStepId: "existing_endpoint",
    drafts: {},
  };
  const shell = shellApi || {
    renderWizardShell: (input) => {
      shell.lastRender = { input, context: { ...input, activeStep: { id: input.activeStepId } } };
      return shell.lastRender;
    },
    closeWizardShell: () => {},
    lastRender: null,
  };
  window.JobBoredDiscoveryWizard.ui.host = makeWizardHost({
    isOnboardingWizardVisible: () => false,
    hideOnboardingWizard: () => {},
    showOnboardingWizard: () => {},
    isSettingsModalOpen: () => false,
    closeCommandCenterSettingsModal: () => {},
    closeDiscoverySetupGuideModal: () => {},
    refreshDiscoveryReadinessSnapshot: async () => ({ localRecoveryState: "ok", recommendedFlow: "local_agent" }),
    getDiscoveryReadinessSnapshot: () => ({ localRecoveryState: "ok" }),
    getDiscoveryWizardProbesApi: () => null,
    mapDiscoveryWizardFlow: (f) => f || "local_agent",
    getDiscoveryWizardStepIds: () => ["detect", "path_select", "existing_endpoint", "verify", "ready"],
    getDiscoveryWizardStepsBefore: () => [],
    createDiscoveryWizardRuntime: (patch) => ({ ...runtime, ...patch }),
    setDiscoveryWizardRuntime: (next) => {
      runtime = next;
      calls.runtimes.push(next);
      return next;
    },
    getDiscoveryWizardRuntime: () => runtime,
    updateDiscoveryWizardRuntime: (patch = {}) => {
      runtime = {
        ...runtime,
        ...patch,
        state: { ...(runtime.state || {}), ...(patch.state || {}) },
        drafts: { ...(runtime.drafts || {}), ...(patch.drafts || {}) },
      };
      return runtime;
    },
    persistDiscoveryWizardState: async () => {},
    getDiscoveryWizardShellApi: () => shell,
    isLocalDashboardOrigin: () => true,
    getDiscoveryLocalEngineLabel: () => "local worker",
    getDiscoveryRecoveryCopy: () => ({ title: "", detectBody: [], actionHint: "" }),
    showToast: (message, tone) => calls.toasts.push({ message, tone }),
  });
  if (autodetect) {
    window.JobBoredDiscoveryAutodetect = {
      recoverIfPossible: async () => {
        calls.autodetect += 1;
        return autodetect;
      },
    };
  }
  return { ui, window, calls, shell, getRuntime: () => runtime };
}

describe("ONEFLOW L3 · autodetect runs during onboarding too (spec §5 B5)", () => {
  it("no entry point is excluded from the probe — the bypass branch is gone", () => {
    assert.ok(
      !/options\.entryPoint\s*!==\s*"onboarding"/.test(discoveryWizardUiJs),
      "the onboarding bypass is exactly the suppression spec §5 B5 removes",
    );
  });

  it("openDiscoverySetupWizard({entryPoint:'onboarding'}) probes the machine", async () => {
    const env = makeOpenEnv({ autodetect: { ready: true } });
    await env.ui.openSetupWizard({ entryPoint: "onboarding" });
    assert.equal(env.calls.autodetect, 1, "onboarding must see its machine checked");
  });

  it("the verdict renders inside the wizard instead of a toast the wizard covers", async () => {
    const env = makeOpenEnv({ autodetect: { ready: true } });
    await env.ui.openSetupWizard({ entryPoint: "onboarding" });
    assert.ok(
      !env.calls.toasts.some((t) => /already set up/i.test(t.message)),
      "a toast behind a modal is the suppressed feedback this lane removes",
    );
    const created = env.calls.runtimes[env.calls.runtimes.length - 1];
    assert.ok(created, "the wizard runtime must be created");
    assert.match(
      String(created.lastWizardMessage || ""),
      /Checked your machine/,
      "autodetect is a visible beat of the wizard, not an invisible one",
    );
  });

  it("an unready machine still reports that it was checked", async () => {
    const env = makeOpenEnv({ autodetect: { ready: false } });
    await env.ui.openSetupWizard({ entryPoint: "manual" });
    const created = env.calls.runtimes[env.calls.runtimes.length - 1];
    assert.match(String(created.lastWizardMessage || ""), /Checked your machine/);
  });

  it("skipAutodetect still bypasses the probe (the seam callers rely on)", async () => {
    const env = makeOpenEnv({ autodetect: { ready: true } });
    await env.ui.openSetupWizard({ entryPoint: "onboarding", skipAutodetect: true });
    assert.equal(env.calls.autodetect, 0);
  });
});

// ---------------------------------------------------------------
// The auto-setup sequence: stage callbacks + the wizard's own busy state
// ---------------------------------------------------------------

function autoSetupEnv({
  tailscale = { installed: true, loggedIn: true },
  workerUp = true,
  serve = { ok: true, url: "https://mac.tailnet.ts.net" },
  verifyResult = { ok: true, message: "Connected." },
  shellApi,
} = {}) {
  const { window, ui } = loadWizardUi();
  const fetched = [];
  const runtime = { drafts: {}, snapshot: {}, state: {} };
  const busy = [];
  const shellRenders = [];
  const shell = shellApi || {
    lastRender: { input: {}, context: {} },
    setBusy: (actionId, stages) => busy.push({ actionId, stages }),
    clearBusy: () => busy.push({ cleared: true }),
    renderWizardShell: (input) => {
      shellRenders.push(input);
      return { input, context: {} };
    },
  };
  window.JobBoredDiscoveryWizard.ui.host = makeWizardHost({
    updateDiscoveryWizardRuntime: (patch) => {
      if (patch && patch.drafts) {
        runtime.drafts = { ...runtime.drafts, ...patch.drafts };
        const { drafts: _d, ...rest } = patch;
        Object.assign(runtime, rest);
      } else if (patch) {
        Object.assign(runtime, patch);
      }
      return runtime;
    },
    getDiscoveryWizardRuntime: () => runtime,
    getDiscoveryWizardShellApi: () => shell,
    mapDiscoveryWizardFlow: (f) => f || "local_agent",
    getDiscoveryReadinessSnapshot: () => ({ localRecoveryState: "ok" }),
    isLocalDashboardOrigin: () => true,
    getDiscoveryLocalEngineLabel: () => "local worker",
    getDiscoveryRecoveryCopy: () => ({ title: "", detectBody: [], actionHint: "" }),
    getDiscoveryWizardStepIds: () => ["detect", "path_select", "existing_endpoint", "verify", "ready"],
  });
  const fetchImpl = async (url, opts = {}) => {
    fetched.push({ url: String(url), method: opts.method || "GET", body: opts.body || null });
    if (String(url).includes("tailscale-state")) return { ok: true, json: async () => tailscale };
    if (String(url).includes("discovery-webhook-secret")) return { ok: false, json: async () => ({}) };
    if (String(url).includes("discovery-state")) {
      return { ok: true, json: async () => ({ ok: true, worker: { up: workerUp } }) };
    }
    if (String(url).includes("full-boot")) return { ok: true, json: async () => ({ ok: true, phases: [] }) };
    if (String(url).includes("tailscale-serve")) return { ok: true, json: async () => serve };
    return { ok: false, json: async () => ({}) };
  };
  const renders = [];
  const deps = {
    fetchImpl,
    verify: async () => {
      runtime.lastVerificationResult = verifyResult;
      return verifyResult;
    },
    render: () => {
      renders.push(1);
      return null;
    },
  };
  return { ui, window, deps, fetched, runtime, busy, renders, shellRenders };
}

describe("ONEFLOW L3 · runTailscaleAutoSetup exposes the sequence with stage callbacks", () => {
  it("is exported so B5 can drive it (spec §5 B5 panel 2)", () => {
    const { ui } = loadWizardUi();
    assert.equal(typeof ui.runTailscaleAutoSetup, "function");
  });

  it("fires the four stages in order, each active then done", async () => {
    const env = autoSetupEnv();
    const seen = [];
    await env.ui.runTailscaleAutoSetup({
      ...env.deps,
      onStage: ({ id, state }) => seen.push(`${id}:${state}`),
    });
    assert.deepEqual(seen, [
      "machine:active",
      "machine:done",
      "worker:active",
      "worker:done",
      "publish:active",
      "publish:done",
      "verify:active",
      "verify:done",
    ]);
  });

  it("hands each callback the full stage list, so a host can render ✓/◌/· live", async () => {
    const env = autoSetupEnv();
    const snapshots = [];
    await env.ui.runTailscaleAutoSetup({
      ...env.deps,
      onStage: ({ stages }) => snapshots.push(plain(stages).map((s) => `${s.id}=${s.state}`)),
    });
    assert.deepEqual(snapshots[0], [
      "machine=active",
      "worker=todo",
      "publish=todo",
      "verify=todo",
    ]);
    assert.deepEqual(snapshots[snapshots.length - 1], [
      "machine=done",
      "worker=done",
      "publish=done",
      "verify=done",
    ]);
  });

  it("returns a normalized outcome the beat can render without reading wizard internals", async () => {
    const env = autoSetupEnv();
    const outcome = await env.ui.runTailscaleAutoSetup(env.deps);
    assert.equal(outcome.ok, true);
    assert.equal(outcome.state, "connected");
    assert.equal(outcome.endpointUrl, "https://mac.tailnet.ts.net/webhook");
  });

  it("reports a blocked machine honestly, with the stage that failed", async () => {
    const env = autoSetupEnv({ tailscale: { installed: false, loggedIn: false } });
    const seen = [];
    const outcome = await env.ui.runTailscaleAutoSetup({
      ...env.deps,
      onStage: ({ id, state }) => seen.push(`${id}:${state}`),
    });
    assert.equal(outcome.ok, false);
    assert.equal(outcome.state, "needs_install");
    assert.match(outcome.message, /Tailscale isn't installed yet — grab it below, then Re-check\./);
    assert.deepEqual(seen, ["machine:active", "machine:failed"]);
  });

  it("suppresses the legacy wizard's own render while a caller drives it (the flow owns the screen)", async () => {
    const env = autoSetupEnv({ tailscale: { installed: true, loggedIn: false } });
    // No injected `render` — the real renderDiscoverySetupWizard must be the
    // thing that stays quiet, not a spy standing in for it.
    const { render: _drop, ...deps } = env.deps;
    await env.ui.runTailscaleAutoSetup(deps);
    assert.equal(
      env.shellRenders.length,
      0,
      "the legacy wizard must not paint itself over the one-flow shell",
    );
  });

  it("un-suppresses afterwards — the standalone wizard still renders itself", async () => {
    const env = autoSetupEnv({ tailscale: { installed: true, loggedIn: false } });
    const { render: _drop, ...deps } = env.deps;
    await env.ui.runTailscaleAutoSetup(deps);
    await env.ui._internal.runDiscoveryTailscaleAutoSetup(deps);
    assert.ok(
      env.shellRenders.length > 0,
      "the guard is scoped to the driven call, never a one-way latch",
    );
  });
});

describe("ONEFLOW L3 · verifyDiscoveryEndpointForFlow — the advanced escape hatch (spec §5 B5)", () => {
  function manualEnv({ verification } = {}) {
    const { window, ui } = loadWizardUi();
    const runtime = { drafts: {}, snapshot: {}, state: {} };
    const shellRenders = [];
    window.JobBoredDiscoveryWizard.ui.host = makeWizardHost({
      getDiscoveryWizardRuntime: () => runtime,
      updateDiscoveryWizardRuntime: (patch = {}) => {
        Object.assign(runtime, patch, {
          state: { ...(runtime.state || {}), ...(patch.state || {}) },
          drafts: { ...(runtime.drafts || {}), ...(patch.drafts || {}) },
        });
        return runtime;
      },
      getDiscoveryWizardShellApi: () => ({
        lastRender: { input: {}, context: {} },
        renderWizardShell: (input) => {
          shellRenders.push(input);
          return { input, context: {} };
        },
      }),
      buildDiscoveryWebhookPayload: async () => ({}),
      verifyDiscoveryWebhookWithSharedModel: async () => verification,
      refreshDiscoveryReadinessSnapshot: async () => ({ localRecoveryState: "ok" }),
      getDiscoveryReadinessSnapshot: () => ({ localRecoveryState: "ok" }),
      getDiscoveryEngineStateFromVerificationResult: () => "connected",
      mapDiscoveryWizardFlow: (f) => f || "external_endpoint",
      persistDiscoveryWizardState: async () => {},
      getDiscoveryWizardStepIds: () => ["detect", "path_select", "existing_endpoint", "verify", "ready"],
      isLocalDashboardOrigin: () => true,
      handleAppsScriptBrowserCorsFailure: async () => false,
      getUserContent: () => null,
    });
    return { ui, runtime, shellRenders };
  }

  it("refuses an empty URL by naming what is missing", async () => {
    const env = manualEnv({ verification: { ok: true } });
    const outcome = await env.ui.verifyDiscoveryEndpointForFlow({ url: "  " });
    assert.equal(outcome.ok, false);
    assert.match(outcome.message, /Paste the worker's HTTPS URL/);
  });

  it("normalizes the URL, keeps the pasted secret, and never renders the legacy wizard", async () => {
    const env = manualEnv({
      verification: { ok: true, kind: "connected", message: "Connected.", engineState: "connected" },
    });
    const outcome = await env.ui.verifyDiscoveryEndpointForFlow({
      url: "https://mac.tailnet.ts.net",
      secret: "shh",
    });
    assert.equal(outcome.ok, true);
    assert.equal(outcome.state, "connected");
    assert.equal(outcome.endpointUrl, "https://mac.tailnet.ts.net/webhook");
    assert.equal(env.runtime.drafts.endpointSecret, "shh");
    assert.equal(
      env.shellRenders.length,
      0,
      "the flow owns the screen for the whole verification",
    );
  });

  it("an empty secret box never clears a secret already on file", async () => {
    const env = manualEnv({ verification: { ok: false, message: "Nope." } });
    env.runtime.drafts.endpointSecret = "already-saved";
    await env.ui.verifyDiscoveryEndpointForFlow({
      url: "https://mac.tailnet.ts.net/webhook",
    });
    assert.equal(env.runtime.drafts.endpointSecret, "already-saved");
  });
});

describe("ONEFLOW L3 · the wizard's own Set it up for me shows real in-flight stages (spec §10 Phase 0)", () => {
  it("drives the shell's setBusy with the four stage strings already written", async () => {
    const env = autoSetupEnv();
    await env.ui._internal.runDiscoveryTailscaleAutoSetup(env.deps);
    const rendered = env.busy.filter((b) => b.stages);
    assert.ok(rendered.length, "20–120 s of silence is the defect this closes");
    assert.equal(rendered[0].actionId, "wizard_tailscale_autosetup");
    assert.deepEqual(plain(rendered[rendered.length - 1].stages).map((s) => s.label), [
      "Checking Tailscale…",
      "Starting the discovery worker…",
      "Publishing the worker on your tailnet…",
      "Verifying the connection…",
    ]);
  });

  it("clears the stage list when the run stops on a blocked machine", async () => {
    const env = autoSetupEnv({ tailscale: { installed: false, loggedIn: false } });
    await env.ui._internal.runDiscoveryTailscaleAutoSetup(env.deps);
    assert.ok(
      env.busy.some((b) => b.cleared),
      "a stalled ◌ row would outlive the failure it belongs to",
    );
  });
});

describe("ONEFLOW L3 · Fix setup gets an in-flight state too (spec §10 Phase 0)", () => {
  it("renders a live stage and disables its trigger while the probe runs", async () => {
    const { window, ui } = loadWizardUi();
    const busy = [];
    const runtime = { drafts: {}, snapshot: {}, state: {} };
    const shell = {
      lastRender: { input: {}, context: {} },
      setBusy: (actionId, stages) => busy.push({ actionId, stages }),
      clearBusy: () => busy.push({ cleared: true }),
      renderWizardShell: () => ({}),
    };
    window.JobBoredDiscoveryWizard.ui.host = makeWizardHost({
      getDiscoveryWizardRuntime: () => runtime,
      updateDiscoveryWizardRuntime: (patch = {}) => Object.assign(runtime, patch),
      refreshDiscoveryReadinessSnapshot: async () => ({ localRecoveryState: "ok" }),
      getDiscoveryReadinessSnapshot: () => ({ localRecoveryState: "ok" }),
      getDiscoveryWizardShellApi: () => shell,
      getDiscoveryWizardProbesApi: () => ({
        requestFixSetup: async () => {
          assert.ok(
            busy.some((b) => b.actionId === "wizard_fix_setup"),
            "the stage list must be up BEFORE the slow call, not after",
          );
          return { ok: true, phases: [{ phase: "verified", message: "Setup restored successfully." }] };
        },
      }),
      persistDiscoveryWizardState: async () => {},
      mapDiscoveryWizardFlow: (f) => f || "local_agent",
      isLocalDashboardOrigin: () => true,
      getDiscoveryLocalEngineLabel: () => "local worker",
      getDiscoveryRecoveryCopy: () => ({ title: "", detectBody: [], actionHint: "" }),
      getDiscoveryWizardStepIds: () => ["detect", "path_select", "bootstrap", "local_health", "tunnel", "relay_deploy", "verify", "ready"],
    });
    await ui.handleAction("wizard_fix_setup");
    assert.ok(busy.some((b) => b.cleared), "and it must come down when the work lands");
  });
});

// ---------------------------------------------------------------
// discovery-wizard-verify.js — the catch-all names a next action
// ---------------------------------------------------------------

describe("ONEFLOW L3 · the unreachable-endpoint catch-all names the first check to run (voice rule §8.4)", () => {
  function loadVerify() {
    const win = { setTimeout, clearTimeout };
    const ctx = {
      window: win,
      console: { warn() {}, error() {}, log() {} },
      setTimeout,
      clearTimeout,
      URL,
      AbortController,
      fetch: async () => {
        throw new TypeError("Failed to fetch");
      },
    };
    // eslint-disable-next-line no-undef
    return { ctx, win };
  }

  it("keeps the taxonomy (network_error / 'Can't reach the endpoint.') and adds a remediation", async () => {
    const vm = await import("node:vm");
    const { ctx, win } = loadVerify();
    vm.createContext(ctx);
    vm.runInContext(readRepoFile("discovery-wizard-verify.js"), ctx, {
      filename: "discovery-wizard-verify.js",
    });
    const verify = win.JobBoredDiscoveryWizard.verify;
    const result = await verify.verifyDiscoveryEndpoint(
      "https://unreachable.example.com/webhook",
      { test: true },
      { context: "test_webhook" },
    );
    assert.equal(result.kind, "network_error", "the taxonomy is unchanged");
    assert.equal(result.message, "Can't reach the endpoint.");
    assert.ok(
      result.remediation && result.remediation.trim().length,
      "'Can't reach the endpoint.' with no next action is a dead end",
    );
    assert.match(
      result.remediation,
      /npm run discovery:bootstrap-local|Re-check|open .* in a browser tab/i,
      "the remediation must name the FIRST check to run, not a shrug",
    );
    assert.match(result.detail, /Tried: https:\/\/unreachable\.example\.com\/webhook/);
  });
});
