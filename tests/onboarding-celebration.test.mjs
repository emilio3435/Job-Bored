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
