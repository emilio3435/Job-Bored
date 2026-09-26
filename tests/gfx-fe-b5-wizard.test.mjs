/**
 * GFX FE-B5 — the discovery wizard's words, names and recommendation.
 *
 *   · D1: one verb for "look again": Check again (no Re-scan, no Re-check).
 *   · D4: "your sheet isn't connected" carries a Connect Sheet action to B1.
 *   · D5: tunnel/relay jargon is plain copy, and Fix setup is the action.
 *   · D6: one name per path — Stable URL · Tailscale, Just this computer,
 *     A web address you own. D7: no_webhook is Skip for now + consequence.
 *     D8: "a web address you already own".
 *   · S10: the wizard's start sentence is localServerHint.
 *   · R9 / D2: the stub_only FLOW is gone from shell, UI and probes; the
 *     stub_only ENGINE STATE stays.
 *   · R9 / D4: the Tailscale probe reaches readiness as tailscaleInstalled,
 *     and exactly one card is Recommended, its label and reason agreeing.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { describe, it } from "node:test";
import {
  loadDiscoveryBeat,
  loadWizardUi,
  makeWizardHost,
  readRepoFile,
} from "./oneflow-l3-harness.mjs";

const LINUX_HINT = "run ./start.sh in the JobBored folder";

const mapFlow = (f) =>
  f === "existing_endpoint" || f === "external_endpoint"
    ? "external_endpoint"
    : f === "no_webhook"
      ? "no_webhook"
      : "local_agent";

function wizardEnv({ snapshot = {}, flow = "local_agent", tailscale } = {}) {
  const { window, ui } = loadWizardUi();
  window.JobBoredLocalServer = { localServerHint: () => LINUX_HINT };
  const calls = { refresh: [], get: [], flowOpen: [], closed: [], persisted: [] };
  const baseSnapshot = { localRecoveryState: "ok", sheetConfigured: true, ...snapshot };
  let runtime = {
    entryPoint: "manual",
    snapshot: baseSnapshot,
    state: { flow, currentStep: "detect", completedSteps: [] },
    activeStepId: "detect",
    drafts: {},
  };
  const shell = {
    lastRender: null,
    renderWizardShell(input) {
      shell.lastRender = { input, context: { ...input, activeStep: { id: input.activeStepId } } };
      return shell.lastRender;
    },
    closeWizardShell(reason) {
      calls.closed.push(reason);
    },
    setBusy() {},
    clearBusy() {},
  };
  window.JobBoredOneFlow = {
    open: async (beat) => {
      calls.flowOpen.push(beat);
    },
  };
  window.JobBoredDiscoveryWizard.ui.host = makeWizardHost({
    isSettingsModalOpen: () => false,
    refreshDiscoveryReadinessSnapshot: async (opts) => {
      calls.refresh.push(opts || {});
      return baseSnapshot;
    },
    getDiscoveryReadinessSnapshot: (opts) => {
      calls.get.push(opts || {});
      return baseSnapshot;
    },
    getDiscoveryWizardProbesApi: () => null,
    mapDiscoveryWizardFlow: mapFlow,
    getDiscoveryWizardStepIds: (f) => [
      "detect",
      "path_select",
      mapFlow(f) === "external_endpoint" ? "existing_endpoint" : mapFlow(f) === "no_webhook" ? "no_webhook" : "bootstrap",
      "verify",
      "ready",
    ],
    getDiscoveryWizardStepsBefore: () => [],
    createDiscoveryWizardRuntime: (patch) => ({ ...runtime, ...patch }),
    setDiscoveryWizardRuntime: (next) => {
      runtime = next;
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
    persistDiscoveryWizardState: async (s) => {
      calls.persisted.push(s);
    },
    getDiscoveryWizardShellApi: () => shell,
    isLocalDashboardOrigin: () => true,
    getDiscoveryLocalEngineLabel: () => "local worker",
    getDiscoveryRecoveryCopy: () => ({ title: "Needs a restart", detectBody: [], actionHint: "" }),
    showToast: () => {},
  });
  const fetchImpl = async (url) => {
    if (String(url).includes("tailscale-state")) {
      if (tailscale instanceof Error) throw tailscale;
      return { ok: true, json: async () => tailscale || { installed: false, loggedIn: false } };
    }
    return { ok: false, json: async () => ({}) };
  };
  return {
    ui,
    window,
    calls,
    shell,
    fetchImpl,
    runtime: () => runtime,
    async open(options = {}) {
      await ui.openSetupWizard({ skipAutodetect: true, fetchImpl, flow, ...options });
      return shell.lastRender.input.steps;
    },
  };
}

const text = (value) => JSON.stringify(value);
const step = (steps, id) => steps.find((s) => s.id === id);
const allActions = (s) => [...(s.actions || []), ...(s.secondaryActions || [])];

describe("GFX-D1 · one verb for looking again", () => {
  it("GFX-D1: the status step offers Check again, never Re-scan", async () => {
    const env = wizardEnv();
    const detect = step(await env.open(), "detect");
    const labels = allActions(detect).map((a) => a.label);
    assert.ok(labels.includes("Check again"), labels.join(", "));
    assert.ok(!labels.includes("Re-scan"));
  });

  it("GFX-D1: blocked Tailscale states say Check again, in the wizard and in B5", async () => {
    const env = wizardEnv({ tailscale: { installed: false, loggedIn: false } });
    const outcome = await env.ui.runTailscaleAutoSetup({ fetchImpl: env.fetchImpl, onStage() {} });
    assert.equal(outcome.state, "needs_install");
    assert.match(outcome.message, /Check again/);
    assert.doesNotMatch(outcome.message, /Re-check/);
    for (const file of ["discovery-wizard-ui.js", "oneflow-beat-discovery.js"]) {
      assert.doesNotMatch(readRepoFile(file), /"Re-check"|"Re-scan"/, `${file} keeps one verb`);
    }
  });
});

describe("GFX-D4 · a missing sheet carries Connect Sheet", () => {
  it("GFX-D4: the status step's action is Connect Sheet, and it goes to B1", async () => {
    const env = wizardEnv({ snapshot: { sheetConfigured: false } });
    const detect = step(await env.open(), "detect");
    assert.equal(detect.actions[0].label, "Connect Sheet");
    assert.doesNotMatch(text(detect.body()), /Pipeline sheet not set up/);
    await env.ui.handleAction(detect.actions[0].id);
    assert.deepEqual(env.calls.flowOpen, ["google"]);
    assert.equal(env.calls.closed.length, 1, "the wizard gets out of B1's way");
  });

  it("GFX-D4: a connected sheet keeps Continue", async () => {
    const env = wizardEnv();
    const detect = step(await env.open(), "detect");
    assert.equal(detect.actions[0].label, "Continue");
  });
});

describe("GFX-D5 · plain recovery copy with a Fix button", () => {
  it("GFX-D5: a rotated tunnel reads plainly and offers Fix setup", async () => {
    const env = wizardEnv({
      snapshot: {
        localRecoveryState: "tunnel_rotated",
        localWebhookUrl: "http://127.0.0.1:8644/webhook",
        localWebhookReady: true,
        tunnelReady: false,
      },
    });
    const steps = await env.open();
    const detect = step(steps, "detect");
    assert.equal(detect.actions[0].id, "wizard_fix_setup");
    assert.equal(detect.actions[0].label, "Fix setup");
    const words = text(detect.body()) + detect.description;
    assert.doesNotMatch(words, /ngrok|relay|redeploy/i);
    const connect = step(steps, "bootstrap");
    assert.doesNotMatch(connect.description, /ngrok|relay|redeploy/i);
  });
});

describe("GFX-D6/D7/D8 · one name per path", () => {
  it("GFX-D6: the path cards carry the three names, and no_webhook is Skip for now", async () => {
    const env = wizardEnv();
    const pick = step(await env.open(), "path_select");
    const cards = pick.body()[0].items;
    assert.deepEqual(
      [...cards.map((c) => c.title)],
      ["Just this computer", "Stable URL · Tailscale", "Skip for now"],
    );
    const skip = cards[2];
    assert.ok(skip.body.some((line) => typeof line === "string" && /won't arrive on their own/.test(line)));
  });

  it("GFX-D6: the shell's path summary uses the same names", () => {
    const env = loadDiscoveryBeat();
    const label = (flow) =>
      env.shell.summarizeSnapshot(env.shell.normalizeSnapshot({ recommendedFlow: flow }))[0].value;
    assert.equal(label("local_agent"), "Just this computer");
    assert.equal(label("external_endpoint"), "Stable URL · Tailscale");
    assert.equal(label("no_webhook"), "Skip for now");
  });

  it("GFX-D7: the manual step's action is Skip for now with a one-line consequence", async () => {
    const env = wizardEnv({ flow: "no_webhook" });
    const manual = step(await env.open(), "no_webhook");
    assert.equal(manual.actions[0].label, "Skip for now");
    assert.match(manual.description, /won't arrive on their own/);
    assert.doesNotMatch(text(manual), /Confirm — no webhook|No webhook \(manual\)/);
  });

  it("GFX-D6/D8: the Tailscale step names A web address you own, in plain words", async () => {
    const env = wizardEnv({ flow: "external_endpoint" });
    const connect = step(await env.open(), "existing_endpoint");
    assert.match(connect.description, /a web address you already own/);
    for (const file of ["discovery-wizard-ui.js", "discovery-wizard-shell.js", "oneflow-beat-discovery.js"]) {
      assert.doesNotMatch(readRepoFile(file), /public HTTPS endpoint you already control/, file);
    }
    const env2 = loadDiscoveryBeat();
    const endpoint = env2.shell.defaultStepBlueprints.find((b) => b.id === "existing_endpoint");
    assert.match(endpoint.description, /a web address you already own/);
  });
});

describe("GFX-S10 · the wizard's start sentence is localServerHint", () => {
  it("GFX-S10: needs_server names the platform's launcher from the substrate", async () => {
    const env = wizardEnv({ tailscale: new TypeError("Failed to fetch") });
    const outcome = await env.ui.runTailscaleAutoSetup({ fetchImpl: env.fetchImpl, onStage() {} });
    assert.equal(outcome.state, "needs_server");
    assert.ok(outcome.message.includes(LINUX_HINT), outcome.message);
    assert.doesNotMatch(outcome.message, /start\.command/);
  });
});

describe("GFX-R9 / D2 · the stub_only flow is gone; the engine state stays", () => {
  it("GFX-R9: the shell maps a stub_only flow to local_agent and has no stub step", () => {
    const env = loadDiscoveryBeat();
    assert.equal(env.shell.normalizeWizardState({ flow: "stub_only" }).flow, "local_agent");
    const snap = env.shell.normalizeSnapshot({
      recommendedFlow: "stub_only",
      engineState: "stub_only",
      appsScriptState: "stub_only",
    });
    assert.equal(snap.recommendedFlow, "local_agent");
    assert.equal(snap.engineState, "stub_only", "the engine state is real and stays");
    assert.equal(snap.appsScriptState, "stub_only");
    assert.ok(![...env.shell.defaultStepIds].includes("stub_only"));
    assert.ok(!env.shell.defaultStepBlueprints.some((b) => b.id === "stub_only"));
  });

  it("GFX-R9: no path card and no wizard step is stub_only", async () => {
    const env = wizardEnv({ flow: "stub_only" });
    const steps = await env.open();
    assert.ok(!steps.some((s) => s.id === "stub_only"));
    const cards = step(steps, "path_select").body()[0].items;
    assert.ok(!cards.some((c) => /stub/i.test(c.title)));
  });

  it("GFX-R9: the probe snapshot never recommends stub_only, and keeps the stub engine state", async () => {
    const storage = new Map([
      [
        "command_center_config_overrides",
        JSON.stringify({
          sheetId: "1mGJ04E3f2Tp0-7ErNlb8veXjnlKz3x5a6gwyzEFvnKQ",
          discoveryWebhookUrl: "https://script.google.com/macros/s/AKfake/exec",
        }),
      ],
    ]);
    const window = { setTimeout, clearTimeout, location: { hostname: "example.test", port: "" } };
    const context = {
      window,
      localStorage: {
        getItem: (k) => (storage.has(k) ? storage.get(k) : null),
        setItem: (k, v) => storage.set(k, String(v)),
        removeItem: (k) => storage.delete(k),
      },
      fetch: async () => ({ ok: false, json: async () => null }),
      URL,
      AbortController,
      console: { ...console, warn() {} },
    };
    const source = await readFile(new URL("../discovery-wizard-probes.js", import.meta.url), "utf8");
    vm.runInNewContext(source, context, { filename: "discovery-wizard-probes.js" });
    const snapshot = await window.JobBoredDiscoveryWizard.probes.buildReadinessSnapshot();
    assert.equal(snapshot.savedWebhookKind, "apps_script_stub");
    assert.notEqual(snapshot.recommendedFlow, "stub_only");
    assert.equal(snapshot.engineState, "stub_only");
  });
});

describe("GFX-R9 / D4 · one recommended card, fed by the Tailscale probe", () => {
  it("GFX-D4: opening the wizard passes the probe to readiness as tailscaleInstalled", async () => {
    const env = wizardEnv({ tailscale: { installed: true, loggedIn: false } });
    await env.open();
    assert.ok(
      env.calls.refresh.some((o) => o.tailscaleInstalled === true),
      JSON.stringify(env.calls.refresh),
    );
  });

  it("GFX-D4: a probe that never answered is unknown, not false", async () => {
    const env = wizardEnv({ tailscale: new TypeError("Failed to fetch") });
    await env.open();
    assert.ok(env.calls.refresh.every((o) => !("tailscaleInstalled" in o)));
  });

  it("GFX-D4: the Set it up for me probe also reaches readiness", async () => {
    const env = wizardEnv({ tailscale: { installed: false, loggedIn: false } });
    await env.ui.runTailscaleAutoSetup({ fetchImpl: env.fetchImpl, onStage() {} });
    assert.ok(env.calls.get.some((o) => o.tailscaleInstalled === false));
  });

  for (const [recommendedFlow, title, reason] of [
    ["existing_endpoint", "Stable URL · Tailscale", "Tailscale is installed on this computer, so a stable Tailscale address is the recommended path."],
    ["local_agent", "Just this computer", "Tailscale isn't installed, so discovery runs on this computer. You can add Tailscale later."],
  ]) {
    it(`GFX-D4: ${recommendedFlow} marks exactly one card, and its reason agrees`, async () => {
      const env = wizardEnv({ snapshot: { recommendedFlow, recommendedReason: reason } });
      const cards = step(await env.open(), "path_select").body()[0].items;
      const marked = cards.filter((c) => c.kicker === "Recommended");
      assert.equal(marked.length, 1);
      assert.equal(marked[0].title, title);
      assert.equal(marked[0].body[0], reason);
      assert.ok(cards.every((c) => !/recommended/i.test(c.title)), "the label lives in the kicker only");
    });
  }
});
