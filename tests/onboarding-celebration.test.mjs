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

  it("opens the wizard even when discovery is already complete (explicit click — always part of setup)", async () => {
    // The advance is click-driven (celebration CTA / gate button). A stale or
    // autodetect-persisted discoverySetupComplete flag must NOT make the
    // button a silent no-op — the wizard renders its connected state instead.
    const calls = [];
    const { onboarding } = loadOnboarding({
      requestDiscoverySetup: (o) => calls.push(o),
      getUserContent: () => makeUC(true),
      resumePendingDiscoverySetupIfNeeded: async () => false,
    });
    await onboarding.advanceToDiscoveryAfterOnboarding();
    assert.equal(calls.length, 1, "the click must always open the wizard");
  });

  it("ignores the pending-setup queue — the click opens the wizard, never the settings modal", async () => {
    const calls = [];
    const resumeCalls = [];
    const { onboarding } = loadOnboarding({
      requestDiscoverySetup: (o) => calls.push(o),
      getUserContent: () => makeUC(false),
      resumePendingDiscoverySetupIfNeeded: async () => {
        resumeCalls.push(1);
        return true;
      },
    });
    await onboarding.advanceToDiscoveryAfterOnboarding();
    assert.equal(
      resumeCalls.length,
      0,
      "the pending queue must not hijack the explicit click into the settings modal",
    );
    assert.equal(calls.length, 1, "the wizard opens directly");
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

  it("when discovery is incomplete, requestDiscoverySetup is called with an onClose callback (no obsolete onComplete)", async () => {
    const env = loadOnboardingWithGate({ discoveryComplete: false });
    await env.onboarding.advanceToDiscoveryAfterOnboarding();
    assert.equal(env.calls.requestDiscovery.length, 1);
    assert.equal(typeof env.calls.requestDiscovery[0].onClose, "function");
    assert.equal(
      typeof env.calls.requestDiscovery[0].onComplete,
      "undefined",
      "the autodetect alreadyConnected shortcut is gone — the wizard always renders, so onClose owns the gate",
    );
  });

  it("onClose with reason !== finish shows the gate panel", async () => {
    const env = loadOnboardingWithGate({ discoveryComplete: false });
    await env.onboarding.advanceToDiscoveryAfterOnboarding();
    await env.calls.requestDiscovery[0].onClose("dismiss", {});
    assert.equal(env.gateEl.hidden, false);
  });

  it("onClose with a SUCCESSFUL finish (reason 'finish' + connected) does NOT re-show the gate", async () => {
    // Regression: the gate must NOT re-assert on the happy path. A genuine
    // discovery finish closes the wizard with reason "finish" and a connected
    // result; the gate must clear, not block the now-set-up user.
    const env = loadOnboardingWithGate({ discoveryComplete: false });
    env.gateEl.removeAttribute("hidden"); // pretend the gate was showing
    await env.onboarding.advanceToDiscoveryAfterOnboarding();
    await env.calls.requestDiscovery[0].onClose("finish", {
      state: { result: "connected" },
    });
    assert.equal(
      env.gateEl.hidden,
      true,
      "a successful discovery finish must clear the gate, not re-block the user",
    );
  });

  it("onClose after connected verify + X/Escape does NOT re-show the gate", async () => {
    // Completion persists at verify time; closing with close-button must not
    // re-block the dashboard when discovery is already connected.
    const env = loadOnboardingWithGate({ discoveryComplete: true });
    env.gateEl.removeAttribute("hidden");
    await env.onboarding.advanceToDiscoveryAfterOnboarding();
    await env.calls.requestDiscovery[0].onClose("close-button", {
      state: { result: "connected" },
    });
    assert.equal(
      env.gateEl.hidden,
      true,
      "verify-then-close must clear the gate even without clicking Finish",
    );
  });

  it("onClose does NOT show the gate when discoverySetupSkipped is true", async () => {
    const env = loadOnboardingWithGate({ discoveryComplete: false, skipFlag: true });
    await env.onboarding.advanceToDiscoveryAfterOnboarding();
    await env.calls.requestDiscovery[0].onClose("dismiss", {});
    assert.equal(env.gateEl.hidden, true);
  });

  it("opens the wizard even when discoverySetupComplete is already true (explicit click)", async () => {
    const env = loadOnboardingWithGate({ discoveryComplete: true });
    await env.onboarding.advanceToDiscoveryAfterOnboarding();
    assert.equal(
      env.calls.requestDiscovery.length,
      1,
      "a stale completion flag must not turn the gate/celebration buttons into no-ops",
    );
  });

  it("the first-run double-open sentinel is gone (the done panel now defers to this chain)", () => {
    // The sentinel patched a double-open created by first-run opening
    // discovery ahead of the profile step. With the done panel deferring to
    // the profile chain, the advance must no longer consult sessionStorage.
    assert.ok(
      !onboardingWizardJs.includes("openedFromFirstRun"),
      "advanceToDiscoveryAfterOnboarding must not read the obsolete sentinel",
    );
  });
});

describe("playOnboardingCelebration — persistent, CTA-driven handoff", () => {
  // The celebration must NOT auto-dismiss on a timer: it persists until the
  // user clicks the continue CTA, which fades the overlay out and then runs
  // onDone (the discovery handoff) — one continuous flow, no intermission.
  function makeCelebrationEl() {
    const attrs = new Map();
    const classes = new Set();
    return {
      attrs,
      classes,
      focusCount: 0,
      clickHandlers: [],
      get hidden() {
        return attrs.has("hidden");
      },
      setAttribute: (n, v) => attrs.set(n, String(v)),
      removeAttribute: (n) => attrs.delete(n),
      hasAttribute: (n) => attrs.has(n),
      classList: {
        add: (c) => classes.add(c),
        remove: (c) => classes.delete(c),
        contains: (c) => classes.has(c),
      },
      addEventListener(type, fn) {
        if (type === "click") this.clickHandlers.push(fn);
      },
      focus() {
        this.focusCount += 1;
      },
      replaceChildren() {},
      appendChild() {},
      style: { setProperty() {} },
    };
  }

  function loadCelebration({ withCta = true } = {}) {
    const overlay = makeCelebrationEl();
    const confetti = makeCelebrationEl();
    const cta = withCta ? makeCelebrationEl() : null;
    const title = makeCelebrationEl();
    const sub = makeCelebrationEl();
    const timers = [];
    const window = { JobBoredApp: { core: { host: {} } } };
    const document = {
      getElementById: (id) =>
        id === "onboardingCelebration"
          ? overlay
          : id === "onboardingCelebrationConfetti"
            ? confetti
            : id === "onboardingCelebrationContinue"
              ? cta
              : id === "onboardingCelebrationTitle"
                ? title
                : id === "onboardingCelebrationSub"
                  ? sub
                  : null,
      createElement: () => makeCelebrationEl(),
    };
    const ctx = {
      window,
      document,
      console,
      setTimeout: (fn, ms) => {
        timers.push({ fn, ms });
        return timers.length;
      },
      clearTimeout: () => {},
    };
    vm.createContext(ctx);
    vm.runInContext(onboardingWizardJs, ctx, { filename: "onboarding-wizard.js" });
    const drainTimers = () => {
      while (timers.length) timers.shift().fn();
    };
    return { onboarding: window.JobBoredApp.onboarding, overlay, cta, title, sub, timers, drainTimers };
  }

  it("persists: no timer-driven dismissal is scheduled, and the CTA gets focus", () => {
    const env = loadCelebration();
    let done = 0;
    env.onboarding.playOnboardingCelebration(() => {
      done += 1;
    });
    assert.equal(env.overlay.hidden, false, "overlay shows");
    assert.equal(
      env.timers.length,
      0,
      "no auto-dismiss timer may be scheduled — the celebration waits for the CTA",
    );
    assert.equal(done, 0, "onDone must NOT fire until the user clicks through");
    assert.equal(env.cta.focusCount, 1, "the continue CTA receives focus (a11y)");
  });

  it("clicking the continue CTA fades out, hides the overlay, and fires onDone exactly once", () => {
    const env = loadCelebration();
    let done = 0;
    env.onboarding.playOnboardingCelebration(() => {
      done += 1;
    });
    assert.equal(env.cta.clickHandlers.length, 1, "CTA must be wired");
    env.cta.clickHandlers[0]();
    assert.ok(
      env.overlay.classes.has("onboarding-celebration--out"),
      "fade-out class applied on click",
    );
    env.drainTimers(); // run the fade-out cleanup timer
    assert.equal(env.overlay.hidden, true, "overlay hidden after the fade");
    assert.equal(done, 1, "onDone fires exactly once, from the click");
  });

  it("falls back to a timed dismissal when the CTA is missing (stale markup) so the handoff never strands", () => {
    const env = loadCelebration({ withCta: false });
    let done = 0;
    env.onboarding.playOnboardingCelebration(() => {
      done += 1;
    });
    assert.ok(env.timers.length >= 1, "a fallback timer must be scheduled");
    env.drainTimers();
    assert.equal(done, 1, "the fallback still completes the handoff");
  });

  it("index.html defines the continue CTA and marks the overlay as a dialog", () => {
    assert.match(indexHtml, /id="onboardingCelebrationContinue"/);
    const i = indexHtml.indexOf('id="onboardingCelebration"');
    const openTag = indexHtml.slice(indexHtml.lastIndexOf("<div", i), indexHtml.indexOf(">", i) + 1);
    assert.match(openTag, /role="dialog"/, "the celebration is interactive now — a dialog, not a status flash");
  });

describe("celebration — one beat between every MAJOR stage (parameterized)", () => {
  it("stage 'devices' retitles the overlay and CTA (discovery → other devices)", () => {
    const env = loadCelebration();
    env.onboarding.playOnboardingCelebration(() => {}, "devices");
    assert.equal(env.title.textContent, "Discovery is live!");
    assert.equal(env.cta.textContent, "Set up other devices →");
    assert.match(env.sub.textContent, /optional step/i);
  });

  it("stage 'profile' celebrates the workspace milestone (sheet/oauth → profile)", () => {
    const env = loadCelebration();
    env.onboarding.playOnboardingCelebration(() => {}, "profile");
    assert.equal(env.title.textContent, "Workspace connected!");
    assert.equal(env.cta.textContent, "Build your profile →");
  });

  it("stage 'bonus' celebrates full setup and gates Maximize your results", () => {
    const env = loadCelebration();
    env.onboarding.playOnboardingCelebration(() => {}, "bonus");
    assert.match(env.title.textContent, /fully set up/i);
    assert.equal(env.cta.textContent, "Maximize your results \u2192");
  });

  it("no stage argument keeps today's profile-finish copy (backward compatible)", () => {
    const env = loadCelebration();
    env.onboarding.playOnboardingCelebration(() => {});
    assert.equal(env.title.textContent, "Profile set!");
    assert.equal(env.cta.textContent, "Set up job discovery →");
  });

  it("first-run's Continue plays the 'profile' stage beat before the dashboard handoff", () => {
    const src = readFileSync(join(repoRoot, "first-run-wizard.js"), "utf8");
    const idx = src.indexOf('getEl("firstRunDoneToDashboard")');
    assert.ok(idx !== -1);
    const body = src.slice(idx, idx + 1400);
    assert.match(body, /playOnboardingCelebration\(proceed, "profile"\)/);
    assert.match(body, /handleFirstRunDoneOpenDiscovery/, "the CTA still owns the existing handoff");
  });

  it("discovery's Continue plays the 'devices' stage beat whose CTA runs the single go-live opener", () => {
    const src = readFileSync(join(repoRoot, "discovery-wizard-ui.js"), "utf8");
    const idx = src.indexOf('actionId === "wizard_continue_devices"');
    assert.ok(idx !== -1);
    const body = src.slice(idx, idx + 1600);
    assert.match(body, /suppressGoLiveAutoOpen: true/, "the auto-chain is suppressed — the celebration CTA owns the open");
    assert.match(body, /playOnboardingCelebration\(proceed, "devices"\)/);
    assert.match(body, /recommendGoLiveAfterDiscoveryFinish/, "the CTA reuses the SAME single opener (no double-open)");
  });
});
});

describe("onboarding gate — hidden attribute must actually hide it (CSS cascade)", () => {
  const onboardingCss = readFileSync(
    join(repoRoot, "css", "legacy-onboarding.css"),
    "utf8",
  );
  it("css has .onboarding-wizard[hidden] { display: none } so the gate can hide", () => {
    // .onboarding-wizard has `display: flex` as its base, which overrides the
    // UA [hidden] rule. The discovery gate toggles visibility via the hidden
    // attribute (showDiscoveryGate/hideDiscoveryGate), so without an explicit
    // [hidden] override the gate shows on load and can never be hidden — both
    // gate buttons then appear dead.
    assert.match(
      onboardingCss,
      /\.onboarding-wizard\[hidden\]\s*\{[^}]*display:\s*none/,
      "the hidden attribute must hide .onboarding-wizard dialogs (gate show/hide depends on it)",
    );
  });
});
