import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

/* ============================================================
   Resume/persona finish → celebrate → carry the user into discovery setup.

   onboarding-wizard.js is a classic-global IIFE under window.JobBoredApp
   .onboarding. The wirings live inside initOnboardingWizard() (not at load),
   so the module loads cleanly with a minimal DOM. We drive the two new seams:
     - advanceToDiscoveryAfterOnboarding() — auto-opens discovery setup when it
       is incomplete (honoring a queued pending setup first).
     - playOnboardingCelebration(onDone) — plays the celebration, then calls
       onDone (graceful immediate done when the overlay is absent).
   ============================================================ */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const onboardingWizardJs = readFileSync(
  join(repoRoot, "onboarding-wizard.js"),
  "utf8",
);
const indexHtml = readFileSync(join(repoRoot, "index.html"), "utf8");

function loadOnboarding(host) {
  const window = { JobBoredApp: { core: { host } } };
  const document = {
    getElementById: () => null,
    createElement: () => ({
      className: "",
      style: {},
      setAttribute() {},
      appendChild() {},
    }),
  };
  const ctx = { window, document, console, setTimeout, clearTimeout };
  vm.createContext(ctx);
  vm.runInContext(onboardingWizardJs, ctx, { filename: "onboarding-wizard.js" });
  return { onboarding: window.JobBoredApp.onboarding, window };
}

const makeUC = (discoveryComplete) => ({
  isDiscoverySetupComplete: async () => discoveryComplete,
});

describe("onboarding finish → discovery auto-advance", () => {
  it("auto-opens discovery setup (entryPoint onboarding) when discovery is incomplete", async () => {
    const calls = [];
    const { onboarding } = loadOnboarding({
      requestDiscoverySetup: (o) => calls.push(o),
      getUserContent: () => makeUC(false),
      resumePendingDiscoverySetupIfNeeded: async () => false,
    });
    await onboarding.advanceToDiscoveryAfterOnboarding();
    assert.equal(calls.length, 1, "must carry the user into discovery setup");
    assert.equal(calls[0].entryPoint, "onboarding");
    assert.equal(calls[0].allowWhileOnboarding, true);
  });

  it("does NOT auto-open discovery when it is already complete", async () => {
    const calls = [];
    const { onboarding } = loadOnboarding({
      requestDiscoverySetup: (o) => calls.push(o),
      getUserContent: () => makeUC(true),
      resumePendingDiscoverySetupIfNeeded: async () => false,
    });
    await onboarding.advanceToDiscoveryAfterOnboarding();
    assert.equal(calls.length, 0, "idempotent when discovery is already set up");
  });

  it("honors a queued pending discovery setup instead of opening the wizard", async () => {
    const calls = [];
    const { onboarding } = loadOnboarding({
      requestDiscoverySetup: (o) => calls.push(o),
      getUserContent: () => makeUC(false),
      resumePendingDiscoverySetupIfNeeded: async () => true, // resumed
    });
    await onboarding.advanceToDiscoveryAfterOnboarding();
    assert.equal(calls.length, 0, "a queued pending setup takes precedence");
  });
});

describe("playOnboardingCelebration", () => {
  it("invokes the done callback even when the overlay element is absent", () => {
    let done = 0;
    const { onboarding } = loadOnboarding({ getUserContent: () => makeUC(false) });
    onboarding.playOnboardingCelebration(() => {
      done += 1;
    });
    assert.equal(done, 1, "graceful immediate handoff when the overlay is missing");
  });
});

describe("index.html — onboarding celebration overlay", () => {
  it("defines the celebration overlay with the celebrating mascot pose", () => {
    assert.match(indexHtml, /id="onboardingCelebration"/);
    assert.match(indexHtml, /pose-07-celebrating/);
  });
});

describe("onboarding-wizard partial — discoverySetupGate markup", () => {
  const onboardingPartial = readFileSync(
    join(repoRoot, "partials", "onboarding-wizard.html"),
    "utf8",
  );
  it("defines #discoverySetupGate hidden by default", () => {
    assert.match(onboardingPartial, /id="discoverySetupGate"/);
    const i = onboardingPartial.indexOf('id="discoverySetupGate"');
    const openTag = onboardingPartial.slice(
      onboardingPartial.lastIndexOf("<div", i),
      onboardingPartial.indexOf(">", i) + 1,
    );
    assert.match(openTag, /\bhidden\b/);
  });
  it("contains the primary [Set up discovery] button (id=discoveryGateOpenWizard)", () => {
    assert.match(onboardingPartial, /id="discoveryGateOpenWizard"/);
  });
  it("contains the confirm-gated escape (id=discoveryGateSkipEscape)", () => {
    assert.match(onboardingPartial, /id="discoveryGateSkipEscape"/);
  });
  it("the escape is visually secondary (not the primary button class)", () => {
    const i = onboardingPartial.indexOf('id="discoveryGateSkipEscape"');
    const ctx = onboardingPartial.slice(i - 300, i + 100);
    assert.ok(!ctx.includes("btn-modal-primary"));
  });
});

describe("advanceToDiscoveryAfterOnboarding — gated blocking handoff", () => {
  function loadOnboardingWithGate({ discoveryComplete, skipFlag = false, confirmResult = true }) {
    const calls = { requestDiscovery: [], setSkipped: 0, completeDiscovery: 0 };
    let hidden = true;
    const gateEl = {
      get hidden() { return hidden; },
      removeAttribute(n) { if (n === "hidden") hidden = false; },
      setAttribute(n) { if (n === "hidden") hidden = true; },
      hasAttribute(n) { return n === "hidden" ? hidden : false; },
    };
    const window = {
      JobBoredApp: { core: { host: {
        requestDiscoverySetup: (o) => calls.requestDiscovery.push(o),
        getUserContent: () => ({
          isDiscoverySetupComplete: async () => discoveryComplete,
          isDiscoverySetupSkipped: async () => skipFlag,
          completeDiscoverySetup: async () => { calls.completeDiscovery++; },
          setDiscoverySetupSkipped: async () => { calls.setSkipped++; },
          openDb: async () => {},
        }),
        resumePendingDiscoverySetupIfNeeded: async () => false,
      } } },
      confirm: () => confirmResult,
      sessionStorage: { getItem: () => null, removeItem: () => {} },
    };
    const document = {
      getElementById: (id) => (id === "discoverySetupGate" ? gateEl : null),
      createElement: () => ({ className: "", style: {}, setAttribute() {}, appendChild() {} }),
    };
    const ctx = { window, document, console, setTimeout, clearTimeout };
    vm.createContext(ctx);
    vm.runInContext(onboardingWizardJs, ctx, { filename: "onboarding-wizard.js" });
    return { onboarding: window.JobBoredApp.onboarding, gateEl, calls, window };
  }

  it("when discovery is incomplete, requestDiscoverySetup is called with onComplete + onClose callbacks", async () => {
    const env = loadOnboardingWithGate({ discoveryComplete: false });
    await env.onboarding.advanceToDiscoveryAfterOnboarding();
    assert.equal(env.calls.requestDiscovery.length, 1);
    assert.equal(typeof env.calls.requestDiscovery[0].onComplete, "function");
    assert.equal(typeof env.calls.requestDiscovery[0].onClose, "function");
  });

  it("onClose with reason !== finish shows the gate panel", async () => {
    const env = loadOnboardingWithGate({ discoveryComplete: false });
    await env.onboarding.advanceToDiscoveryAfterOnboarding();
    await env.calls.requestDiscovery[0].onClose("dismiss", {});
    assert.equal(env.gateEl.hidden, false);
  });

  it("onClose does NOT show the gate when discoverySetupSkipped is true", async () => {
    const env = loadOnboardingWithGate({ discoveryComplete: false, skipFlag: true });
    await env.onboarding.advanceToDiscoveryAfterOnboarding();
    await env.calls.requestDiscovery[0].onClose("dismiss", {});
    assert.equal(env.gateEl.hidden, true);
  });

  it("onComplete with alreadyConnected:true persists discoverySetupComplete and hides the gate", async () => {
    const env = loadOnboardingWithGate({ discoveryComplete: false });
    env.gateEl.removeAttribute("hidden");
    await env.onboarding.advanceToDiscoveryAfterOnboarding();
    await env.calls.requestDiscovery[0].onComplete({ alreadyConnected: true });
    assert.equal(env.calls.completeDiscovery, 1);
    assert.equal(env.gateEl.hidden, true);
  });

  it("is idempotent when discoverySetupComplete is already true", async () => {
    const env = loadOnboardingWithGate({ discoveryComplete: true });
    await env.onboarding.advanceToDiscoveryAfterOnboarding();
    assert.equal(env.calls.requestDiscovery.length, 0);
  });
});
