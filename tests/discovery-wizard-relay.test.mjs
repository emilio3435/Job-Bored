import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const discoveryWizardRelayJs = readFileSync(
  join(repoRoot, "discovery-wizard-relay.js"),
  "utf8",
);

// ============================================================
// Behavioral coverage for the Cloudflare relay wizard model.
//
// discovery-wizard-relay.js is a classic-global IIFE under
// window.JobBoredDiscoveryWizard.relay. It is the wizard's pure decision
// layer: it classifies endpoint URLs, resolves the downstream relay target,
// builds the exact deploy command/agent prompt the user copies, and gates
// what may be saved as the browser-facing webhook. We load it into a fresh
// VM context per test with a stubbed (or empty) JobBoredDiscoveryHelpers
// namespace — never the real discovery-shared-helpers.js — and drive the
// window.* exports directly. No network, no DOM, no timers are involved.
// ============================================================

function loadRelay({ helpers, preWindow } = {}) {
  const window = preWindow || {};
  if (helpers !== undefined) {
    window.JobBoredDiscoveryHelpers = helpers;
  }
  const ctx = { window, console, setTimeout, clearTimeout, URL };
  vm.createContext(ctx);
  vm.runInContext(discoveryWizardRelayJs, ctx, {
    filename: "discovery-wizard-relay.js",
  });
  return { window, relay: window.JobBoredDiscoveryWizard.relay };
}

const WORKER_URL = "https://jobbored-discovery-relay.foo.workers.dev";
const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycb123/exec";
const GENERIC_HTTPS_URL = "https://hooks.example.com/discovery";

describe("discovery-wizard-relay — classifyRelayEndpointUrl (endpoint triage gates every save)", () => {
  // The classifier is the wizard's gatekeeper: a wrong verdict either lets a
  // useless URL get saved (localhost, /forward) or blocks a perfectly good
  // Worker URL. These run with NO helper functions so the module's built-in
  // fallback classification (the path taken when discovery-shared-helpers.js
  // fails to load) is what gets verified.
  function classify(url, snapshot) {
    const { relay } = loadRelay({ helpers: {} });
    return relay.classifyRelayEndpointUrl(url, snapshot || {});
  }

  it("an empty URL is 'missing' with blockingIssue missing_endpoint — the wizard must ask for a URL, not validate nothing", () => {
    const out = classify("");
    assert.equal(out.kind, "missing");
    assert.equal(out.ok, false);
    assert.equal(out.realReady, false);
    assert.equal(out.blockingIssue, "missing_endpoint");
  });

  it("localhost and private-LAN URLs are rejected — the engine cannot call back into the user's machine", () => {
    for (const url of [
      "http://localhost:8644/webhook",
      "http://127.0.0.1:8644/webhook",
      "http://192.168.1.5:8644/webhook",
    ]) {
      const out = classify(url);
      assert.equal(out.kind, "local_only", url);
      assert.equal(out.ok, false, url);
      assert.equal(out.blockingIssue, "local_only", url);
    }
  });

  it("a Worker /forward URL is rejected — saving the relay's internal path instead of the root URL breaks delivery", () => {
    const out = classify(`${WORKER_URL}/forward`);
    assert.equal(out.kind, "worker_forward");
    assert.equal(out.ok, false);
    assert.equal(out.blockingIssue, "worker_forward");
  });

  it("an open workers.dev root URL is the ready-to-save happy path (ok + realReady)", () => {
    const out = classify(WORKER_URL);
    assert.equal(out.kind, "worker_open");
    assert.equal(out.ok, true);
    assert.equal(out.realReady, true);
    assert.equal(out.blockingIssue, "");
  });

  it("an Apps Script web app is accepted but flagged realReady:false when the snapshot says stub-only — testing webhooks must not look like real discovery", () => {
    const out = classify(APPS_SCRIPT_URL, { appsScriptState: "stub_only" });
    assert.equal(out.kind, "apps_script_stub");
    assert.equal(out.ok, true);
    assert.equal(out.realReady, false);
    assert.equal(out.blockingIssue, "stub_only");
  });

  it("an Apps Script web app WITHOUT a stub-only snapshot is realReady — a managed-stub flag elsewhere must not condemn every GAS endpoint", () => {
    const out = classify(APPS_SCRIPT_URL, {});
    assert.equal(out.kind, "apps_script_stub");
    assert.equal(out.realReady, true);
    assert.equal(out.blockingIssue, "");
  });

  it("any public HTTPS endpoint is usable (generic_https) — bring-your-own-relay stays supported", () => {
    const out = classify(GENERIC_HTTPS_URL);
    assert.equal(out.kind, "generic_https");
    assert.equal(out.ok, true);
    assert.equal(out.realReady, true);
  });

  it("plain-HTTP public URLs and garbage are 'invalid_endpoint' — sheet data must never travel unencrypted", () => {
    assert.equal(classify("http://example.com/webhook").kind, "invalid_endpoint");
    assert.equal(classify("not a url at all").kind, "invalid_endpoint");
    assert.equal(classify("http://example.com/webhook").ok, false);
  });
});

describe("discovery-wizard-relay — buildDownstreamTargetUrl (relay target precedence)", () => {
  // The downstream target is what the deployed Worker forwards to. Getting
  // precedence wrong recreates the ngrok-rotation bug (a stale relayTargetUrl
  // outliving the live tunnel) or a relay loop (the Worker forwarding to
  // itself).
  function target(snapshot, overrides) {
    const { relay } = loadRelay({ helpers: {} });
    return relay.buildDownstreamTargetUrl(snapshot, overrides);
  }

  it("an explicit targetUrl override beats everything — the caller's choice is authoritative", () => {
    const out = target(
      { relayTargetUrl: GENERIC_HTTPS_URL },
      { targetUrl: "https://override.example.com/hook" },
    );
    assert.equal(out, "https://override.example.com/hook");
  });

  it("a live tunnel + local webhook compose host-from-tunnel + path-from-local with query/hash stripped — so ngrok URL rotations never serve a stale host", () => {
    const out = target({
      localWebhookUrl: "http://127.0.0.1:8644/webhook?token=1#frag",
      tunnelPublicUrl: "https://abc-123.ngrok.app/old-path?y=2",
      relayTargetUrl: "https://stale.example.com/webhook",
    });
    assert.equal(out, "https://abc-123.ngrok.app/webhook");
  });

  it("a persisted generic-HTTPS relayTargetUrl is reused when no live tunnel exists", () => {
    assert.equal(target({ relayTargetUrl: GENERIC_HTTPS_URL }), GENERIC_HTTPS_URL);
  });

  it("a relayTargetUrl that is itself a Worker URL is skipped — forwarding the relay to itself would loop", () => {
    const out = target({
      relayTargetUrl: WORKER_URL,
      savedWebhookUrl: GENERIC_HTTPS_URL,
    });
    assert.equal(out, GENERIC_HTTPS_URL, "must fall through to the saved generic endpoint");
  });

  it("a saved browser-facing Worker URL alone yields NO downstream target — the dashboard-facing URL is never the relay's destination", () => {
    assert.equal(target({ savedWebhookUrl: WORKER_URL }), "");
  });
});

describe("discovery-wizard-relay — deploy command + agent prompt (what the user actually copies and runs)", () => {
  function build({ snapshot = {}, options = {} } = {}) {
    const { relay } = loadRelay({ helpers: {} });
    return {
      command: relay.buildCloudflareRelayDeployCommand(snapshot, options),
      prompt: relay.buildCloudflareRelayAgentPrompt(snapshot, options),
    };
  }

  it("the deploy command carries the quoted target, sheet id, and cors origin so a copy-paste run deploys the right relay", () => {
    const { command } = build({
      snapshot: { relayTargetUrl: GENERIC_HTTPS_URL },
      options: { sheetId: "1AbC", corsOrigin: "https://dash.example.com" },
    });
    assert.ok(command.startsWith("npm run cloudflare-relay:deploy --"), command);
    assert.ok(command.includes(`--target-url '${GENERIC_HTTPS_URL}'`), command);
    assert.ok(command.includes("--sheet-id '1AbC'"), command);
    assert.ok(command.includes("--cors-origin 'https://dash.example.com'"), command);
  });

  it("a wildcard cors origin is omitted from the command — '*' is the deploy script's default, not a flag worth pinning", () => {
    const { command } = build({
      snapshot: { relayTargetUrl: GENERIC_HTTPS_URL },
      options: { corsOrigin: "*" },
    });
    assert.ok(!command.includes("--cors-origin"), command);
  });

  it("redeploying with a Worker already saved reuses ITS name — a fresh suggested name would silently create a second worker", () => {
    const { command } = build({
      snapshot: {
        savedWebhookUrl: "https://my-relay.foo.workers.dev",
        relayTargetUrl: GENERIC_HTTPS_URL,
      },
    });
    assert.ok(command.includes("--worker-name 'my-relay'"), command);
  });

  it("an explicit workerName is sanitized to a valid Cloudflare name before it reaches the command line", () => {
    const { command } = build({
      snapshot: { relayTargetUrl: GENERIC_HTTPS_URL },
      options: { workerName: "My Cool Worker!!" },
    });
    assert.ok(command.includes("--worker-name 'my-cool-worker'"), command);
  });

  it("with no downstream target the agent prompt STOPS instead of fabricating a deploy — there is nothing useful to relay to", () => {
    const { prompt } = build();
    assert.ok(prompt.includes("Stop: there is no downstream TARGET_URL"), prompt);
    assert.ok(
      !prompt.includes("cloudflare-relay:deploy"),
      "a stop-prompt must not hand the agent a runnable deploy command",
    );
  });

  it("with a target the prompt embeds the TARGET_URL and the exact deploy command so the agent runs what the wizard computed", () => {
    const { prompt, command } = build({
      snapshot: { relayTargetUrl: GENERIC_HTTPS_URL },
    });
    assert.ok(prompt.includes(`Current TARGET_URL: ${GENERIC_HTTPS_URL}`), prompt);
    assert.ok(prompt.includes(command), "the prompt's command must match the copyable command");
  });

  it("the verify instruction adapts: sheet-id deploys self-verify, otherwise the user is told to paste + Test webhook", () => {
    const withSheet = build({
      snapshot: { relayTargetUrl: GENERIC_HTTPS_URL },
      options: { sheetId: "1AbC" },
    }).prompt;
    assert.ok(withSheet.includes("let the helper run webhook verification"), withSheet);
    const withoutSheet = build({
      snapshot: { relayTargetUrl: GENERIC_HTTPS_URL },
    }).prompt;
    assert.ok(
      withoutSheet.includes("paste the Worker URL into Discovery drawer"),
      withoutSheet,
    );
  });
});

describe("discovery-wizard-relay — buildWorkerUrlApplyResult (the save gate for the browser-facing URL)", () => {
  // Only an open workers.dev root URL may produce a settings patch. Every
  // rejected shape must return patch:null, otherwise a bad URL gets persisted
  // and discovery silently 404s/loops later.
  function apply(url, options) {
    const { relay } = loadRelay({ helpers: {} });
    return relay.buildWorkerUrlApplyResult(url, {}, options);
  }

  it("an empty paste is rejected with no patch — nothing must be written to settings", () => {
    const out = apply("");
    assert.equal(out.ok, false);
    assert.equal(out.patch, null);
  });

  it("a localhost URL is rejected with no patch — saving it would point the dashboard at an unreachable endpoint", () => {
    const out = apply("http://127.0.0.1:8787");
    assert.equal(out.ok, false);
    assert.equal(out.patch, null);
  });

  it("a /forward Worker URL is rejected with no patch — the internal relay path must never become the saved webhook", () => {
    const out = apply(`${WORKER_URL}/forward`);
    assert.equal(out.ok, false);
    assert.equal(out.patch, null);
  });

  it("a generic HTTPS endpoint is rejected here — this action saves the BROWSER-facing Worker URL specifically", () => {
    const out = apply(GENERIC_HTTPS_URL);
    assert.equal(out.ok, false);
    assert.equal(out.patch, null);
  });

  it("an open workers.dev URL yields the exact settings patch (url + kind worker + cloudflare_worker source)", () => {
    const out = apply(WORKER_URL);
    assert.equal(out.ok, true);
    assert.equal(out.kind, "connected_ok");
    // Spread into a host-realm object: the patch is built inside the VM, and
    // deepStrictEqual rejects cross-realm prototypes.
    assert.deepEqual({ ...out.patch }, {
      discoveryWebhookUrl: WORKER_URL,
      discoveryWebhookKind: "worker",
      discoveryWebhookSource: "cloudflare_worker",
    });
  });

  it("an explicit options.source is recorded in the patch so provenance survives (wizard vs manual paste)", () => {
    const out = apply(WORKER_URL, { source: "relay_wizard" });
    assert.equal(out.patch.discoveryWebhookSource, "relay_wizard");
  });
});

describe("discovery-wizard-relay — buildExternalEndpointValidationResult (verdicts the verify step renders)", () => {
  function validate(url, snapshot, preWindow) {
    const { relay } = loadRelay({ helpers: {}, preWindow });
    return relay.buildExternalEndpointValidationResult(url, snapshot || {});
  }

  it("a missing URL fails as invalid_endpoint with a 'paste first' message — the verify button must not pretend it probed anything", () => {
    const out = validate("");
    assert.equal(out.ok, false);
    assert.equal(out.kind, "invalid_endpoint");
    assert.equal(out.message, "Paste a webhook URL first.");
  });

  it("local-only and /forward URLs fail validation with the classifier's own title/detail so the user sees WHY", () => {
    const local = validate("http://127.0.0.1:8644/webhook");
    assert.equal(local.ok, false);
    assert.equal(local.kind, "invalid_endpoint");
    assert.equal(local.message, local.endpoint.title);
    const forward = validate(`${WORKER_URL}/forward`);
    assert.equal(forward.ok, false);
    assert.equal(forward.kind, "invalid_endpoint");
  });

  it("an Apps Script stub validates ok but as stub_only with engineState stub_only — the wizard advances without claiming real discovery", () => {
    const out = validate(APPS_SCRIPT_URL);
    assert.equal(out.ok, true);
    assert.equal(out.kind, "stub_only");
    assert.equal(out.engineState, "stub_only");
  });

  it("a Worker URL validates as connected_ok but engineState 'unverified' — URL shape alone must never claim a live engine", () => {
    const out = validate(WORKER_URL);
    assert.equal(out.ok, true);
    assert.equal(out.kind, "connected_ok");
    assert.equal(out.engineState, "unverified");
    assert.equal(out.validation, "shape_only");
  });

  it("a stub_only engine snapshot is NOT upgraded by a valid-looking Worker URL — shape validation cannot launder a stub into connected", () => {
    const out = validate(WORKER_URL, { engineState: "stub_only" });
    assert.equal(out.engineState, "stub_only");
  });

  it("contract verificationResult defaults flow into every verdict — downstream renderers rely on the contract's field set", () => {
    const preWindow = {
      JobBoredDiscoveryWizard: {
        contract: {
          verificationResult: {
            ok: false,
            kind: "invalid_endpoint",
            engineState: "none",
            httpStatus: 0,
            message: "",
            detail: "",
            layer: "browser",
            probeChannel: "relay_wizard",
          },
        },
      },
    };
    const out = validate(WORKER_URL, {}, preWindow);
    assert.equal(out.probeChannel, "relay_wizard", "contract-only fields must ride through");
    assert.equal(out.layer, "browser");
  });
});

describe("discovery-wizard-relay — wizard model + runRelayWizardAction dispatch", () => {
  // buildRelayWizardModel decides which actions the UI offers; the dispatcher
  // is the single entry point the wizard shell calls. A wrong gate shows dead
  // buttons (or hides live ones); a silent unknown-action success would mask
  // wiring bugs between shell and relay.
  function load() {
    return loadRelay({ helpers: {} });
  }

  it("an empty snapshot offers NO actions — there is nothing to deploy, apply, or validate yet", () => {
    const { relay } = load();
    const model = relay.buildRelayWizardModel({}, {});
    assert.deepEqual([...model.actions], []);
  });

  it("a downstream target unlocks relay_deploy_worker; a saved Worker URL unlocks apply + validate", () => {
    const { relay } = load();
    const model = relay.buildRelayWizardModel(
      { relayTargetUrl: GENERIC_HTTPS_URL, savedWebhookUrl: WORKER_URL },
      {},
    );
    assert.ok(model.actions.includes("relay_deploy_worker"), JSON.stringify(model.actions));
    assert.ok(model.actions.includes("relay_apply_worker_url"), JSON.stringify(model.actions));
    assert.ok(
      model.actions.includes("relay_validate_external_endpoint"),
      JSON.stringify(model.actions),
    );
  });

  it("the model carries stubOnly:true when the snapshot is stub-flavored — the UI must badge test-mode honestly", () => {
    const { relay } = load();
    const flagged = relay.buildRelayWizardModel({ appsScriptState: "stub_only" }, {});
    assert.equal(flagged.stubOnly, true);
    const clean = relay.buildRelayWizardModel({ savedWebhookUrl: WORKER_URL }, {});
    assert.equal(clean.stubOnly, undefined, "a real Worker setup must not be badged as stub");
  });

  it("relay_copy_deploy_command resolves the SAME text as the command builder — the copy button and the docs must never diverge", async () => {
    const { relay } = load();
    const snapshot = { relayTargetUrl: GENERIC_HTTPS_URL };
    const out = await relay.runRelayWizardAction("relay_copy_deploy_command", {
      snapshot,
      options: { sheetId: "1AbC" },
    });
    assert.equal(out.ok, true);
    assert.equal(
      out.text,
      relay.buildCloudflareRelayDeployCommand(snapshot, { sheetId: "1AbC" }),
    );
  });

  it("relay_validate_external_endpoint prefers the typed input.url over the saved snapshot URL — validating what the user just edited", async () => {
    const { relay } = load();
    const out = await relay.runRelayWizardAction("relay_validate_external_endpoint", {
      snapshot: { savedWebhookUrl: GENERIC_HTTPS_URL },
      url: "http://127.0.0.1:8644/webhook",
    });
    assert.equal(out.ok, true, "the action itself succeeds; the verdict lives in .validation");
    assert.equal(out.validation.ok, false, "the typed local URL must be the one judged");
  });

  it("relay_apply_worker_url routes input.workerUrl through the save gate and returns its patch", async () => {
    const { relay } = load();
    const out = await relay.runRelayWizardAction("relay_apply_worker_url", {
      snapshot: {},
      workerUrl: WORKER_URL,
    });
    assert.equal(out.ok, true);
    assert.equal(out.patch.discoveryWebhookUrl, WORKER_URL);
  });

  it("relay_deploy_worker bundles a consistent deployment (targetUrl + command agree) so the UI renders one coherent plan", async () => {
    const { relay } = load();
    const out = await relay.runRelayWizardAction("relay_deploy_worker", {
      snapshot: { relayTargetUrl: GENERIC_HTTPS_URL },
    });
    assert.equal(out.ok, true);
    assert.equal(out.deployment.targetUrl, GENERIC_HTTPS_URL);
    assert.ok(out.deployment.command.includes(`--target-url '${GENERIC_HTTPS_URL}'`));
    assert.ok(out.deployment.command.includes(`--worker-name '${out.deployment.workerName}'`));
  });

  it("an unknown actionId fails loudly (ok:false, unsupported_action, id echoed) — a silent success would hide shell/relay wiring bugs", async () => {
    const { relay } = load();
    const out = await relay.runRelayWizardAction("relay_nuke_everything", {});
    assert.equal(out.ok, false);
    assert.equal(out.kind, "unsupported_action");
    assert.equal(out.actionId, "relay_nuke_everything");
  });

  it("getDefaultRelayActionIds returns a fresh copy — a consumer mutating its list must not corrupt the canonical set", () => {
    const { relay } = load();
    const first = relay.getDefaultRelayActionIds();
    first.push("relay_evil_extra");
    first.splice(0, 1);
    const second = relay.getDefaultRelayActionIds();
    assert.ok(second.includes("relay_prepare_target"));
    assert.ok(!second.includes("relay_evil_extra"));
  });
});

describe("discovery-wizard-relay — snapshot + wizard-state normalizers (persistence round-trips)", () => {
  function load(preWindow) {
    return loadRelay({ helpers: {}, preWindow });
  }

  it("string/number boolean-ish values from persisted JSON coerce strictly ('true' and 1 only) — sloppy truthiness would mark dead tunnels ready", () => {
    const { relay } = load();
    const snap = relay.normalizeRelaySnapshot({
      tunnelReady: "true",
      relayReady: 1,
      localWebhookReady: "yes",
      sheetConfigured: 0,
    });
    assert.equal(snap.tunnelReady, true);
    assert.equal(snap.relayReady, true);
    assert.equal(snap.localWebhookReady, false, "'yes' is not an accepted truthy form");
    assert.equal(snap.sheetConfigured, false);
  });

  it("URLs are trimmed and absent enum fields fall back to safe defaults (kind none, engine none, flow local_agent)", () => {
    const { relay } = load();
    const snap = relay.normalizeRelaySnapshot({
      savedWebhookUrl: `  ${WORKER_URL}  `,
    });
    assert.equal(snap.savedWebhookUrl, WORKER_URL);
    assert.equal(snap.savedWebhookKind, "none");
    assert.equal(snap.engineState, "none");
    assert.equal(snap.recommendedFlow, "local_agent");
  });

  it("contract readinessSnapshot defaults seed the normalized snapshot so all renderers share one baseline", () => {
    const preWindow = {
      JobBoredDiscoveryWizard: {
        contract: { readinessSnapshot: { engineState: "connected" } },
      },
    };
    const { relay } = load(preWindow);
    const snap = relay.normalizeRelaySnapshot({});
    assert.equal(snap.engineState, "connected");
  });

  it("wizard state is pinned to version 1 with deduped completedSteps — duplicated persisted steps would corrupt the progress rail", () => {
    const { relay } = load();
    const state = relay.normalizeRelayWizardState({
      version: 99,
      completedSteps: ["detect", "detect", "", null, "verify"],
      dismissedStubWarning: "true",
    });
    assert.equal(state.version, 1);
    assert.deepEqual([...state.completedSteps], ["detect", "verify"]);
    assert.equal(state.dismissedStubWarning, true);
  });

  it("an empty wizard state resumes at the canonical start (local_agent / path_select / result none) — no undefined steps after a fresh install", () => {
    const { relay } = load();
    const state = relay.normalizeRelayWizardState(null);
    assert.equal(state.flow, "local_agent");
    assert.equal(state.currentStep, "path_select");
    assert.equal(state.result, "none");
  });
});

describe("discovery-wizard-relay — shared-helpers delegation + namespace co-existence", () => {
  // The module captures window.JobBoredDiscoveryHelpers at load and must
  // treat it as the canonical URL brain when present: if a helper and the
  // inline fallback ever disagree, the helper wins, or relay verdicts drift
  // from the rest of discovery. It also must merge into an existing
  // JobBoredDiscoveryWizard namespace, not clobber siblings loaded earlier.
  it("classifySavedWebhookKind delegates to the helpers namespace (call recorded, helper verdict returned verbatim)", () => {
    const calls = [];
    const helpers = {
      classifySavedWebhookKind: (url) => {
        calls.push(url);
        return "worker";
      },
    };
    const { relay } = loadRelay({ helpers });
    const out = relay.classifySavedWebhookKind("https://anything.example.com");
    assert.equal(out, "worker", "the helper's verdict must be authoritative");
    assert.deepEqual(calls, ["https://anything.example.com"]);
  });

  it("endpoint classification trusts helper isLikelyWorkerUrl over the inline regex — custom worker domains recognized by the shared brain stay recognized here", () => {
    const customWorker = "https://relay.custom-domain.example/";
    const helpers = {
      isLikelyWorkerUrl: (url) => String(url).includes("custom-domain.example"),
      isWorkerForwardUrl: () => false,
      isLocalHost: () => false,
    };
    const { relay } = loadRelay({ helpers });
    const out = relay.classifyRelayEndpointUrl(customWorker, {});
    assert.equal(out.kind, "worker_open", "the helper's worker verdict must drive the kind");
    assert.equal(out.ok, true);
  });

  it("loading without ANY helpers namespace still classifies correctly — the relay module must survive a failed shared-helpers script", () => {
    const { relay } = loadRelay(); // window.JobBoredDiscoveryHelpers absent entirely
    assert.equal(relay.classifyRelayEndpointUrl(WORKER_URL, {}).kind, "worker_open");
    assert.equal(
      relay.classifyRelayEndpointUrl("http://127.0.0.1:8644/webhook", {}).kind,
      "local_only",
    );
  });

  it("the IIFE merges into an existing JobBoredDiscoveryWizard namespace without clobbering siblings (script-order safety)", () => {
    const uiSentinel = { marker: "ui-loaded-first" };
    const preWindow = { JobBoredDiscoveryWizard: { ui: uiSentinel } };
    const { window } = loadRelay({ helpers: {}, preWindow });
    assert.equal(window.JobBoredDiscoveryWizard.ui, uiSentinel, "siblings must survive");
    assert.equal(
      typeof window.JobBoredDiscoveryWizard.relay.runRelayWizardAction,
      "function",
      "relay must attach alongside",
    );
  });
});
