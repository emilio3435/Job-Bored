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
  function autoSetupEnv({ tailscale, workerUp = true, serve, secret, verifyResult } = {}) {
    const { window, ui } = loadDiscoveryUi();
    const fetched = [];
    const runtime = { drafts: {}, snapshot: {}, state: {} };
    window.JobBoredDiscoveryWizard.ui.host = {
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
    };
    const fetchImpl = async (url, opts = {}) => {
      fetched.push({ url: String(url), method: opts.method || "GET", body: opts.body || null });
      if (String(url).includes("tailscale-state")) {
        return { ok: true, json: async () => tailscale };
      }
      if (String(url).includes("discovery-webhook-secret")) {
        return secret
          ? { ok: true, json: async () => secret }
          : { ok: false, json: async () => ({}) };
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
          verified.push({
            url,
            context,
            secretAtVerify: (runtime.drafts && runtime.drafts.endpointSecret) || "",
          });
          if (verifyResult !== undefined) runtime.lastVerificationResult = verifyResult;
          return null;
        },
        render: () => {
          renders.push(1);
          return null;
        },
      });
    return { run, fetched, verified, runtime, getDrafts: () => runtime.drafts };
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
  // ---- secret autofill + honest verify outcome ----
  // The 401 killer: the worker fail-closes without the shared secret, and the
  // dashboard had nothing saved — so verification 401'd and the status card
  // hung on "Working on it…". The chain now resolves the secret server-side
  // (same resolve-or-generate helper the local bootstrap uses) and reconciles
  // the status card with the verification outcome.
  const happy = {
    tailscale: { installed: true, loggedIn: true },
    serve: { ok: true, url: "https://mac.tailnet.ts.net" },
  };

  it("autofills the worker secret server-side so verification authenticates (nothing to paste)", async () => {
    const env = autoSetupEnv({
      ...happy,
      secret: { ok: true, secret: "s3cr3t", source: "env_file", wrote: false },
      verifyResult: { ok: true },
    });
    await env.run();
    assert.equal(env.verified.length, 1);
    assert.equal(
      env.verified[0].secretAtVerify,
      "s3cr3t",
      "the resolved secret must ride along with the verification",
    );
    assert.equal(
      env.getDrafts().tailscaleAutoState,
      "",
      "a successful verification clears the status card",
    );
  });

  it("a freshly GENERATED secret forces a worker (re)boot so the worker loads it", async () => {
    const env = autoSetupEnv({
      ...happy,
      workerUp: true, // up, but started BEFORE the secret existed
      secret: { ok: true, secret: "fresh", source: "generated", wrote: true },
      verifyResult: { ok: true },
    });
    await env.run();
    const boot = env.fetched.find((f) => f.url.includes("full-boot"));
    assert.ok(boot, "must reboot the worker to pick up the new secret");
    assert.match(boot.url, /skip_tunnel=1/);
  });

  it("a failed verification surfaces honestly instead of hanging on 'Working on it…'", async () => {
    const env = autoSetupEnv({
      ...happy,
      secret: { ok: true, secret: "s3cr3t", source: "env_file", wrote: false },
      verifyResult: { ok: false, message: "Unauthorized (401) — the worker rejected the request." },
    });
    await env.run();
    assert.equal(env.getDrafts().tailscaleAutoState, "failed");
    assert.match(
      env.getDrafts().tailscaleAutoDetail,
      /Unauthorized/,
      "the card must carry the verification failure, not a perpetual spinner",
    );
  });

  it("never overwrites a secret the user already typed", async () => {
    const env = autoSetupEnv({
      ...happy,
      secret: { ok: true, secret: "resolved", source: "env_file", wrote: false },
      verifyResult: { ok: true },
    });
    env.runtime.drafts.endpointSecret = "user-typed";
    await env.run();
    assert.equal(env.verified[0].secretAtVerify, "user-typed");
  });
});

describe("discovery-wizard-ui — setup verification uses the auth-probe handshake", () => {
  // Root cause (reproduced live): the verify probe was a REAL discovery
  // dispatch, so the worker rejected it with 400 "Discovery intent cannot be
  // blank when no target companies are configured" whenever the profile was
  // empty — the wizard never advanced even though transport + auth were
  // perfect. The worker's x-discovery-auth-probe handshake short-circuits
  // BEFORE intent validation and never launches a run.
  it("handleDiscoveryWizardVerification sends x-discovery-auth-probe for setup contexts only", () => {
    const start = discoveryWizardUiJs.indexOf(
      "async function handleDiscoveryWizardVerification",
    );
    assert.ok(start !== -1);
    const head = discoveryWizardUiJs.slice(start, start + 3200);
    assert.match(
      head,
      /x-discovery-auth-probe/,
      "setup verification must use the worker's handshake, not a real dispatch",
    );
    assert.match(
      head,
      /context !== "run_discovery"/,
      "a REAL run dispatch must never be downgraded to a probe",
    );
    assert.match(
      head,
      /script\\\.google/,
      "Apps Script stubs are exempt (GAS preflight chokes on custom headers)",
    );
  });
});

describe("discovery-readiness — verify wrapper forwards custom headers", () => {
  it("verifyDiscoveryWebhookWithSharedModel threads options.headers to verifyDiscoveryEndpoint", () => {
    // The wizard sends x-discovery-auth-probe via options.headers; the
    // readiness wrapper rebuilt the inner options and silently dropped it,
    // so the worker still treated setup verification as a real dispatch.
    const readinessJs = readFileSync(join(repoRoot, "discovery-readiness.js"), "utf8");
    const start = readinessJs.indexOf("async function verifyDiscoveryWebhookWithSharedModel");
    assert.ok(start !== -1);
    const body = readinessJs.slice(start, start + 1600);
    assert.match(
      body,
      /options\.headers/,
      "the wrapper must forward options.headers (the auth-probe rides on it)",
    );
  });
});

describe("discovery-wizard-ui — detect checklist is flow-conditional (P1)", () => {
  it("ngrok/relay rows are guarded off the Tailscale (external_endpoint) flow", () => {
    // The step-1 "check" showed "No ngrok tunnel running / Cloudflare relay
    // deployed" on the Tailscale-first flow — alarms about machinery this
    // path doesn't use.
    const start = discoveryWizardUiJs.indexOf("function buildDiscoveryDetectBody");
    assert.ok(start !== -1);
    const body = discoveryWizardUiJs.slice(start, start + 4200);
    assert.match(body, /isExternalFlow/, "the builder must know the active flow");
    const guardIdx = body.indexOf("if (!isExternalFlow)");
    assert.ok(guardIdx !== -1, "tunnel/relay rows must sit behind a non-external guard");
    const ngrokIdx = body.indexOf("No ngrok tunnel running");
    const relayIdx = body.indexOf("Cloudflare relay deployed");
    assert.ok(ngrokIdx > guardIdx, "ngrok row inside the guard");
    assert.ok(relayIdx > guardIdx, "relay row inside the guard");
  });
});
