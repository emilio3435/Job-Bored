import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

/* ============================================================
   Onboarding funnel telemetry — a tiny, local-only event hook.

   The chain (first-run -> discovery -> go-live, plus the setup bar) emits a
   single stable CustomEvent ("jobbored:onboarding") at each step so drop-off
   is observable. Privacy-safe + OSS-friendly: no network, no storage, no PII —
   just the step name + the existing entryPoint. No listener attached by
   default => no-op.

   These tests pin (a) the module's emit mechanics and (b) that each chain step
   fires exactly one event with the right stable step name.
   ============================================================ */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => readFileSync(join(repoRoot, f), "utf8");
const telemetryJs = read("onboarding-telemetry.js");
const indexHtml = read("index.html");
const discoveryWizardUiJs = read("discovery-wizard-ui.js");
const goLiveJs = read("go-live-wizard-ui.js");
const whatsNextBannerJs = read("whats-next-banner.js");
const firstRunWizardJs = read("first-run-wizard.js");

// A CustomEvent shim that records constructed events (Node has no DOM).
function makeCustomEvent(record) {
  return class CustomEvent {
    constructor(type, init) {
      this.type = type;
      this.detail = (init && init.detail) || null;
      this.bubbles = !!(init && init.bubbles);
      record.push(this);
    }
  };
}

function loadTelemetry({ withCustomEvent = true } = {}) {
  const constructed = [];
  const dispatched = [];
  const window = {};
  if (withCustomEvent) window.CustomEvent = makeCustomEvent(constructed);
  const document = {
    dispatchEvent: (ev) => {
      dispatched.push(ev);
      return true;
    },
  };
  const ctx = { window, document, console };
  vm.createContext(ctx);
  vm.runInContext(telemetryJs, ctx, { filename: "onboarding-telemetry.js" });
  return { api: window.JobBoredOnboardingTelemetry, constructed, dispatched, window };
}

describe("onboarding-telemetry module", () => {
  it("emit dispatches one 'jobbored:onboarding' CustomEvent carrying the step", () => {
    const { api, dispatched } = loadTelemetry();
    api.emit("discovery_opened", { entryPoint: "onboarding" });
    assert.equal(dispatched.length, 1);
    assert.equal(dispatched[0].type, "jobbored:onboarding");
    assert.equal(dispatched[0].detail.step, "discovery_opened");
    assert.equal(dispatched[0].detail.entryPoint, "onboarding");
  });

  it("exposes a stable EVENT_NAME and a frozen STEPS vocabulary", () => {
    const { api } = loadTelemetry();
    assert.equal(api.EVENT_NAME, "jobbored:onboarding");
    assert.equal(api.STEPS.FIRST_RUN_DONE, "first_run_done");
    assert.equal(api.STEPS.BOTH_DONE, "both_done");
    assert.throws(() => {
      api.STEPS.FIRST_RUN_DONE = "mutated";
    }, "STEPS must be frozen so the funnel vocabulary can't drift at runtime");
  });

  it("is a no-op (never throws) when CustomEvent is unavailable", () => {
    const { api, dispatched } = loadTelemetry({ withCustomEvent: false });
    assert.doesNotThrow(() => api.emit("first_run_done"));
    assert.equal(dispatched.length, 0);
  });

  it("ignores an empty step (nothing to record)", () => {
    const { api, dispatched } = loadTelemetry();
    api.emit("");
    api.emit(null);
    assert.equal(dispatched.length, 0);
  });

  it("index.html loads onboarding-telemetry.js before the wizard modules", () => {
    const t = indexHtml.indexOf("onboarding-telemetry.js");
    assert.ok(t !== -1, "index.html must load onboarding-telemetry.js");
    for (const mod of [
      "discovery-wizard-ui.js",
      "go-live-wizard-ui.js",
      "first-run-wizard.js",
      "whats-next-banner.js",
    ]) {
      assert.ok(
        t < indexHtml.indexOf(mod),
        `onboarding-telemetry.js must load before ${mod} (it emits the funnel events)`,
      );
    }
  });
});

// ---- Each chain step fires exactly one event with the right stable name ----
// Spy injection: every module looks up window.JobBoredOnboardingTelemetry
// lazily, so a stub captures (step, detail) without loading the real module.

function spyTelemetry(window) {
  const calls = [];
  window.JobBoredOnboardingTelemetry = {
    emit: (step, detail) => calls.push({ step, detail: detail || {} }),
  };
  return calls;
}

describe("onboarding-telemetry — chain step emissions", () => {
  it("discovery finish emits discovery_finished (and both_done only when go-live already complete)", async () => {
    for (const [goLiveComplete, expectBothDone] of [
      [false, false],
      [true, true],
    ]) {
      const window = {};
      const calls = spyTelemetry(window);
      const ctx = {
        window,
        document: { createElement: () => ({}), body: {} },
        console,
        setTimeout,
        clearTimeout,
      };
      vm.createContext(ctx);
      vm.runInContext(discoveryWizardUiJs, ctx, {
        filename: "discovery-wizard-ui.js",
      });
      const UC = {
        completeDiscoverySetup: async () => {},
        isGoLiveSetupComplete: async () => goLiveComplete,
      };
      window.JobBoredDiscoveryWizard.ui.host = {
        getUserContent: () => UC,
        requestGoLiveSetup: () => {},
      };
      await window.JobBoredDiscoveryWizard.ui._internal.recommendGoLiveAfterDiscoveryFinish();
      const steps = calls.map((c) => c.step);
      assert.equal(
        steps.filter((s) => s === "discovery_finished").length,
        1,
        "discovery_finished must fire exactly once on finish",
      );
      assert.equal(
        steps.includes("both_done"),
        expectBothDone,
        `both_done should ${expectBothDone ? "" : "NOT "}fire when go-live ${goLiveComplete ? "already complete" : "incomplete"}`,
      );
    }
  });

  it("go-live finish emits go_live_finished (and both_done only when discovery already complete)", async () => {
    for (const [discoveryComplete, expectBothDone] of [
      [false, false],
      [true, true],
    ]) {
      const window = { JobBoredApp: { core: { host: {} } }, JobBoredDiscoveryWizard: {} };
      const calls = spyTelemetry(window);
      window.JobBoredDiscoveryWizard.shell = {
        renderWizardShell: () => ({}),
        closeWizardShell: () => {},
      };
      window.CommandCenterUserContent = {
        completeGoLiveSetup: async () => {},
        isDiscoverySetupComplete: async () => discoveryComplete,
      };
      const ctx = {
        window,
        document: { createElement: () => ({}), body: {} },
        console,
        setTimeout,
        clearTimeout,
        fetch: async () => ({ ok: false }),
      };
      vm.createContext(ctx);
      vm.runInContext(goLiveJs, ctx, { filename: "go-live-wizard-ui.js" });
      window.JobBoredGoLive.host = {
        isOnboardingWizardVisible: () => false,
        isFirstRunWizardVisible: () => false,
        requestDiscoverySetup: () => {},
      };
      await window.JobBoredGoLive.handleAction("go_live_complete_tailscale");
      const steps = calls.map((c) => c.step);
      assert.equal(
        steps.filter((s) => s === "go_live_finished").length,
        1,
        "go_live_finished must fire exactly once on finish",
      );
      assert.equal(steps.includes("both_done"), expectBothDone);
    }
  });

  it("pressing Later on the setup bar emits later_pressed", () => {
    const window = { JobBoredApp: {}, sessionStorage: makeSessionStorage() };
    const calls = spyTelemetry(window);
    const document = makeBannerDocument();
    const ctx = {
      window,
      document,
      console,
      setTimeout,
      requestAnimationFrame: (fn) => fn(),
    };
    vm.createContext(ctx);
    vm.runInContext(whatsNextBannerJs, ctx, { filename: "whats-next-banner.js" });
    window.JobBoredApp.whatsNextBanner.handleLater();
    assert.equal(
      calls.filter((c) => c.step === "later_pressed").length,
      1,
      "later_pressed must fire exactly once when Later is pressed",
    );
  });

  it("finishing the first-run wizard emits first_run_done", async () => {
    const window = { JobBoredApp: { core: {} } };
    const calls = spyTelemetry(window);
    const document = makeBannerDocument();
    const UC = { openDb: async () => {}, completeInfraSetup: async () => {} };
    window.JobBoredApp.core.host = {
      isSignedIn: () => true,
      getSheetId: () => "sheet-123",
      getResumeGenerate: () => ({ isResumeGenerationConfigured: () => true }),
      getUserContent: () => UC,
      revealDashboardShell: () => {},
    };
    const ctx = {
      window,
      document,
      console,
      setTimeout,
      requestAnimationFrame: (fn) => fn(),
    };
    vm.createContext(ctx);
    vm.runInContext(firstRunWizardJs, ctx, { filename: "first-run-wizard.js" });
    await window.JobBoredApp.firstRunWizard.handleFirstRunFinish();
    assert.equal(
      calls.filter((c) => c.step === "first_run_done").length,
      1,
      "first_run_done must fire exactly once when first-run completes",
    );
  });

  it("opening the discovery setup wizard emits discovery_opened with the entry point", async () => {
    const window = {};
    const calls = spyTelemetry(window);
    const ctx = {
      window,
      document: { createElement: () => ({}), body: {} },
      console,
      setTimeout,
      clearTimeout,
    };
    vm.createContext(ctx);
    vm.runInContext(discoveryWizardUiJs, ctx, {
      filename: "discovery-wizard-ui.js",
    });
    // No host wired => the open will reject downstream; the emit fires first.
    await Promise.resolve(
      window.JobBoredDiscoveryWizard.ui.openSetupWizard({
        entryPoint: "onboarding",
        skipAutodetect: true,
      }),
    ).catch(() => {});
    const opened = calls.filter((c) => c.step === "discovery_opened");
    assert.equal(opened.length, 1, "discovery_opened must fire once per open");
    assert.equal(opened[0].detail.entryPoint, "onboarding");
  });

  it("opening the go-live setup wizard emits go_live_opened with the entry point", async () => {
    const window = { JobBoredApp: { core: { host: {} } }, JobBoredDiscoveryWizard: {} };
    const calls = spyTelemetry(window);
    window.JobBoredDiscoveryWizard.shell = {
      renderWizardShell: () => ({}),
      closeWizardShell: () => {},
    };
    const ctx = {
      window,
      document: { createElement: () => ({}), body: {} },
      console,
      setTimeout,
      clearTimeout,
      fetch: async () => ({ ok: false }),
    };
    vm.createContext(ctx);
    vm.runInContext(goLiveJs, ctx, { filename: "go-live-wizard-ui.js" });
    window.JobBoredGoLive.host = {
      isOnboardingWizardVisible: () => false,
      hideOnboardingWizard: () => {},
    };
    await Promise.resolve(
      window.JobBoredGoLive.openGoLiveSetupWizard({ entryPoint: "onboarding_chain" }),
    ).catch(() => {});
    const opened = calls.filter((c) => c.step === "go_live_opened");
    assert.equal(opened.length, 1, "go_live_opened must fire once per open");
    assert.equal(opened[0].detail.entryPoint, "onboarding_chain");
  });
});

function makeSessionStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
}

function makeBannerDocument() {
  const els = new Map();
  const makeEl = () => {
    const attrs = new Map();
    return {
      dataset: {},
      style: {},
      hasAttribute: (n) => attrs.has(n),
      setAttribute: (n, v) => attrs.set(n, String(v)),
      removeAttribute: (n) => attrs.delete(n),
      getAttribute: (n) => (attrs.has(n) ? attrs.get(n) : null),
      addEventListener() {},
      appendChild: (c) => c,
      querySelector: () => null,
      classList: { add() {}, remove() {}, contains: () => false },
      focus() {},
    };
  };
  const region = makeEl();
  return {
    readyState: "complete",
    body: makeEl(),
    getElementById: (id) => {
      if (!els.has(id)) els.set(id, makeEl());
      return els.get(id);
    },
    querySelector: (sel) =>
      sel === '[data-region="whats-next"]' ? region : null,
    querySelectorAll: () => [],
    addEventListener() {},
    createElement: () => makeEl(),
  };
}
