import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const discoveryWizardUiJs = readFileSync(
  join(repoRoot, "discovery-wizard-ui.js"),
  "utf8",
);

// ============================================================
// Behavioral coverage for the discovery -> go-live auto-chain.
//
// discovery-wizard-ui.js is a classic-global IIFE under
// window.JobBoredDiscoveryWizard.ui. recommendGoLiveAfterDiscoveryFinish is
// module-private; it is reachable here via the ui._internal test seam (mirrors
// go-live's root._internal). We load the module into a fresh VM context and
// drive the helper directly with a stubbed host bridge so a broken persist or a
// broken goLiveDone gate FAILS the build (the getUserContent bridge bug class).
//
// The module only touches `window` at load time (every document/DOM call lives
// inside a function body), so a minimal global set is enough to load it.
// ============================================================

function loadDiscoveryUi() {
  const window = {};
  const ctx = {
    window,
    document: {
      createElement: () => ({ appendChild() {}, setAttribute() {}, style: {} }),
      body: { appendChild() {}, removeChild() {} },
    },
    console,
    setTimeout,
    clearTimeout,
    URL, // ensureDiscoveryWebhookUrl parses URLs (browser global)
  };
  vm.createContext(ctx);
  vm.runInContext(discoveryWizardUiJs, ctx, {
    filename: "discovery-wizard-ui.js",
  });
  return { window, ui: window.JobBoredDiscoveryWizard.ui };
}

// Stub user-content store that records flag reads/writes so the test asserts
// the helper actually persisted and gated, not just that it ran.
function makeUC({ goLiveComplete }) {
  const calls = { completeDiscovery: 0, isGoLiveComplete: 0 };
  return {
    calls,
    completeDiscoverySetup: async () => {
      calls.completeDiscovery++;
    },
    isGoLiveSetupComplete: async () => {
      calls.isGoLiveComplete++;
      return goLiveComplete;
    },
  };
}

describe("discovery-wizard-ui — recommendGoLiveAfterDiscoveryFinish (behavioral)", () => {
  it("persists discoverySetupComplete and auto-opens go-live (onboarding_chain) when go-live is incomplete", async () => {
    const { window, ui } = loadDiscoveryUi();
    const UC = makeUC({ goLiveComplete: false });
    const goLiveCalls = [];
    window.JobBoredDiscoveryWizard.ui.host = {
      getUserContent: () => UC,
      requestGoLiveSetup: (opts) => {
        goLiveCalls.push(opts);
      },
    };

    await ui._internal.recommendGoLiveAfterDiscoveryFinish();

    assert.equal(
      UC.calls.completeDiscovery,
      1,
      "must persist discoverySetupComplete on finish",
    );
    assert.equal(
      goLiveCalls.length,
      1,
      "must auto-open go-live exactly once when it is incomplete",
    );
    assert.equal(goLiveCalls[0].entryPoint, "onboarding_chain");
    assert.equal(goLiveCalls[0].allowWhileOnboarding, true);
  });

  it("persists discoverySetupComplete but does NOT auto-open go-live when go-live is already complete", async () => {
    const { window, ui } = loadDiscoveryUi();
    const UC = makeUC({ goLiveComplete: true });
    const goLiveCalls = [];
    window.JobBoredDiscoveryWizard.ui.host = {
      getUserContent: () => UC,
      requestGoLiveSetup: (opts) => {
        goLiveCalls.push(opts);
      },
    };

    await ui._internal.recommendGoLiveAfterDiscoveryFinish();

    assert.equal(
      UC.calls.completeDiscovery,
      1,
      "must still persist discoverySetupComplete even when both tracks finish",
    );
    assert.equal(
      goLiveCalls.length,
      0,
      "must NOT auto-open go-live once both tracks are complete (anti-ping-pong)",
    );
  });
});

describe("discovery-wizard-ui — openDiscoverySetupWizard onClose seam + onboarding lane", () => {
  it("references options.onClose (the gate's re-assert hook)", () => {
    assert.match(
      discoveryWizardUiJs,
      /async function openDiscoverySetupWizard\(options\s*=\s*\{\}\)/,
    );
    assert.match(discoveryWizardUiJs, /options\.onClose\b/);
  });

  it("the autodetect lane is BYPASSED for entryPoint:onboarding — the wizard always renders as part of setup", () => {
    // Discovery setup is a real step of onboarding: even a healthy local
    // stack must render the wizard (showing its connected state) instead of
    // short-circuiting to a toast — otherwise the celebration CTA appears to
    // dump the user on the dashboard.
    const start = discoveryWizardUiJs.indexOf(
      "// ====== [discovery-autodetect lane: silent recover] ======",
    );
    const block = discoveryWizardUiJs.slice(start, start + 1200);
    assert.match(
      block,
      /options\.entryPoint !== "onboarding"/,
      "the autodetect lane condition must exclude the onboarding entry point",
    );
    assert.ok(
      !discoveryWizardUiJs.includes("alreadyConnected"),
      "the autodetect alreadyConnected shortcut is gone (the wizard renders instead)",
    );
  });

  it("the onClose handler forwards (reason, ctx) to options.onClose when provided", () => {
    const onCloseIdx = discoveryWizardUiJs.indexOf("onClose: (reason, ctx) =>");
    assert.ok(onCloseIdx !== -1);
    const body = discoveryWizardUiJs.slice(onCloseIdx, onCloseIdx + 3000);
    assert.match(body, /typeof options\.onClose === "function"/);
    assert.match(body, /options\.onClose\(reason,\s*ctx\)/);
  });
});

describe("discovery-wizard-ui — resolveDiscoveryWizardEntry (onboarding starts fresh, Tailscale-first)", () => {
  const mapFlow = (f) => f; // identity — host's alias mapping is out of scope
  const getStepIds = (flow) =>
    flow === "external_endpoint"
      ? ["detect", "path_select", "existing_endpoint", "verify", "ready"]
      : ["detect", "path_select", "bootstrap", "local_health", "tunnel", "relay_deploy", "verify", "ready"];

  function entry(overrides) {
    const { ui } = loadDiscoveryUi();
    return ui._internal.resolveDiscoveryWizardEntry({
      entryPoint: "manual",
      flowOption: null,
      startStepOption: null,
      savedState: null,
      snapshot: { localRecoveryState: "ok", recommendedFlow: "local_agent" },
      mapFlow,
      getStepIds,
      ...overrides,
    });
  }

  it("onboarding entry ALWAYS starts fresh at detect with the Tailscale-first flow — stale state and recovery alarms ignored", () => {
    const out = entry({
      entryPoint: "onboarding",
      savedState: { flow: "local_agent", currentStep: "local_health", completedSteps: ["detect", "path_select", "bootstrap"] },
      snapshot: { localRecoveryState: "needs_full_restart", recommendedFlow: "local_agent" },
    });
    assert.equal(out.flow, "external_endpoint", "Tailscale (external_endpoint) is the onboarding default");
    assert.equal(out.step, "detect", "must open on step 1, never a resumed/recovery step");
    assert.equal(out.freshState, true, "persisted mid-flow state must not leak into onboarding");
    assert.equal(out.snapshot.recommendedFlow, "external_endpoint", "the step-1 check + path badge read Tailscale-first");
    assert.equal(out.snapshot.localRecoveryState, "ok", "ngrok-flavored recovery alarms are noise on the Tailscale path");
  });

  it("non-onboarding entries keep the recovery route (local_agent + bootstrap)", () => {
    const out = entry({
      snapshot: { localRecoveryState: "worker_down", recommendedFlow: "local_agent" },
    });
    assert.equal(out.flow, "local_agent");
    assert.equal(out.step, "bootstrap");
    assert.equal(out.freshState, false);
    assert.equal(out.snapshot.localRecoveryState, "worker_down", "non-onboarding snapshot is untouched");
  });

  it("non-onboarding entries still resume a valid persisted step", () => {
    const out = entry({
      savedState: { flow: "local_agent", currentStep: "tunnel", completedSteps: [] },
    });
    assert.equal(out.flow, "local_agent");
    assert.equal(out.step, "tunnel");
  });
});

describe("discovery-wizard-ui — runDiscoveryTailscaleAutoSetup (one-click Tailscale)", () => {
  // The plug-and-play chain: tailscale-state → (worker boot if down, tunnel
  // skipped) → tailscale serve 8644 → derive the /webhook URL → the SAME
  // verification the manual path uses (persists + advances to Done). Human
  // input only where physically unavoidable (install / sign-in), surfaced as
  // drafts.tailscaleAutoState so the endpoint card renders guidance.
  function autoSetupEnv({ tailscale, workerUp = true, serve } = {}) {
    const { window, ui } = loadDiscoveryUi();
    const fetched = [];
    let drafts = {};
    window.JobBoredDiscoveryWizard.ui.host = {
      updateDiscoveryWizardRuntime: (patch) => {
        if (patch && patch.drafts) drafts = { ...drafts, ...patch.drafts };
        return { drafts };
      },
      getDiscoveryWizardRuntime: () => ({ drafts, snapshot: {}, state: {} }),
    };
    const fetchImpl = async (url, opts = {}) => {
      fetched.push({ url: String(url), method: opts.method || "GET", body: opts.body || null });
      if (String(url).includes("tailscale-state")) {
        return { ok: true, json: async () => tailscale };
      }
      if (String(url).includes("discovery-state")) {
        return { ok: true, json: async () => ({ ok: true, worker: { up: workerUp } }) };
      }
      if (String(url).includes("full-boot")) {
        return { ok: true, json: async () => ({ ok: true, phases: [] }) };
      }
      if (String(url).includes("tailscale-serve")) {
        return { ok: true, json: async () => serve };
      }
      return { ok: false, json: async () => ({}) };
    };
    const verified = [];
    const renders = [];
    const run = () =>
      ui._internal.runDiscoveryTailscaleAutoSetup({
        fetchImpl,
        verify: async (url, context) => {
          verified.push({ url, context });
          return null;
        },
        render: () => {
          renders.push(1);
          return null;
        },
      });
    return { run, fetched, verified, getDrafts: () => drafts };
  }

  it("happy path: serves 8644 and verifies the derived /webhook URL (zero terminal steps)", async () => {
    const env = autoSetupEnv({
      tailscale: { installed: true, loggedIn: true },
      workerUp: true,
      serve: { ok: true, url: "https://mac.tailnet.ts.net" },
    });
    await env.run();
    const serveCall = env.fetched.find((f) => f.url.includes("tailscale-serve"));
    assert.ok(serveCall, "must call tailscale-serve");
    assert.match(serveCall.body, /8644/, "must serve the WORKER port");
    assert.equal(env.verified.length, 1, "must hand off to the shared verification");
    assert.equal(env.verified[0].url, "https://mac.tailnet.ts.net/webhook");
  });

  it("boots the worker WITHOUT the ngrok/relay phases when it is down", async () => {
    const env = autoSetupEnv({
      tailscale: { installed: true, loggedIn: true },
      workerUp: false,
      serve: { ok: true, url: "https://mac.tailnet.ts.net" },
    });
    await env.run();
    const boot = env.fetched.find((f) => f.url.includes("full-boot"));
    assert.ok(boot, "must boot the worker when it is down");
    assert.match(boot.url, /skip_tunnel=1/, "Tailscale path must skip the ngrok/relay phases");
    assert.equal(env.verified.length, 1, "still verifies after the boot");
  });

  it("stops with install guidance when Tailscale is missing (no serve, no verify)", async () => {
    const env = autoSetupEnv({ tailscale: { installed: false, loggedIn: false } });
    await env.run();
    assert.equal(env.getDrafts().tailscaleAutoState, "needs_install");
    assert.ok(!env.fetched.some((f) => f.url.includes("tailscale-serve")));
    assert.equal(env.verified.length, 0);
  });

  it("stops with sign-in guidance when Tailscale is installed but logged out", async () => {
    const env = autoSetupEnv({ tailscale: { installed: true, loggedIn: false } });
    await env.run();
    assert.equal(env.getDrafts().tailscaleAutoState, "needs_login");
    assert.equal(env.verified.length, 0);
  });

  it("fails honestly when tailscale serve errors (manual paste remains the fallback)", async () => {
    const env = autoSetupEnv({
      tailscale: { installed: true, loggedIn: true },
      serve: { ok: false, url: null, error: "serve failed" },
    });
    await env.run();
    assert.equal(env.getDrafts().tailscaleAutoState, "failed");
    assert.equal(env.verified.length, 0);
  });
});
