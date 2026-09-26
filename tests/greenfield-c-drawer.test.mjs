import assert from "node:assert/strict";
import { describe, it } from "node:test";
import vm from "node:vm";
import { makeFakeDocument, readRepoFile } from "./oneflow-l0-harness.mjs";

/* ============================================================
   GREENFIELD C1 — the drawer's one setup button lands in the flow.

   GREENFIELD-SPEC §1 F3 / §4.4. `Open discovery setup` in the drawer's
   Connection section called requestDiscoverySetup, which opens the LEGACY
   three-step wizard into #discoverySetupWizardMount — a second onboarding
   surface beside the six beats. It now opens the flow at Beat 5, and only
   falls back to the old call when the flow global is absent (a page that
   loaded the drawer without onboarding-flow.js).
   ============================================================ */

function loadSetupModals({ oneFlow } = {}) {
  const doc = makeFakeDocument();
  const button = doc.register("settingsDiscoveryOpenSetupBtn");
  const wizardMount = doc.register("discoverySetupWizardMount");
  doc.register("settingsDiscoveryTestBtn");
  const win = {};
  const ctx = {
    window: win,
    document: doc,
    console: { warn() {}, error() {}, log() {} },
    setTimeout,
    clearTimeout,
    Object,
    Array,
    String,
    Number,
    Boolean,
    JSON,
    Date,
    Promise,
    Math,
    Error,
  };
  if (oneFlow) win.JobBoredOneFlow = oneFlow;
  vm.createContext(ctx);
  vm.runInContext(readRepoFile("discovery-setup-modals.js"), ctx, {
    filename: "discovery-setup-modals.js",
  });
  const setupModals = win.JobBoredDiscovery.setupModals;
  const hostCalls = [];
  setupModals.host = {
    requestDiscoverySetup(options) {
      hostCalls.push({ name: "requestDiscoverySetup", args: [options] });
      // The legacy wizard mounts here — the thing C1 stops happening.
      wizardMount.appendChild(doc.createElement("div"));
      return Promise.resolve({ deferred: false });
    },
  };
  setupModals.initDiscoverySetupGuide();
  return { doc, win, button, wizardMount, hostCalls };
}

describe("GREENFIELD C1 · the drawer's setup button opens the six-beat flow", () => {
  it("opens the flow at the discovery beat instead of the legacy wizard", () => {
    const openCalls = [];
    const env = loadSetupModals({
      oneFlow: {
        open(beatId, options) {
          openCalls.push([beatId, options]);
          return Promise.resolve(true);
        },
      },
    });

    env.button.dispatch("click");

    assert.equal(openCalls.length, 1, "the flow is opened exactly once");
    assert.equal(openCalls[0][0], "discovery", "Beat 5 IS discovery setup");
    assert.equal(
      openCalls[0][1] && openCalls[0][1].returnTo,
      "close",
      "a deep link closes the shell when its beat completes (spec §4.1)",
    );
    assert.deepEqual(
      env.hostCalls,
      [],
      "the legacy requestDiscoverySetup path must not fire when the flow exists",
    );
    assert.equal(
      env.wizardMount.children.length,
      0,
      "#discoverySetupWizardMount stays empty — no second onboarding surface",
    );
  });

  it("falls back to requestDiscoverySetup when the flow global is absent", () => {
    const env = loadSetupModals({ oneFlow: null });

    env.button.dispatch("click");

    assert.equal(env.hostCalls.length, 1, "the legacy wizard stays reachable");
    assert.equal(env.hostCalls[0].name, "requestDiscoverySetup");
    assert.equal(env.hostCalls[0].args[0].entryPoint, "settings");
    assert.equal(env.hostCalls[0].args[0].allowWhileOnboarding, true);
  });

  it("falls back when the flow global exists but cannot open", () => {
    const env = loadSetupModals({ oneFlow: { registerBeat() {} } });

    env.button.dispatch("click");

    assert.equal(
      env.hostCalls.length,
      1,
      "a half-loaded flow global is not a reason to strand the button",
    );
  });
});
