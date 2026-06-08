import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const statusHandoffJs = readFileSync(
  join(repoRoot, "discovery-status-handoff.js"),
  "utf8",
);
const setupJs = readFileSync(join(repoRoot, "sheet-access-setup.js"), "utf8");

const HANDOFF_SECTION_START = statusHandoffJs.indexOf(
  'const PENDING_DISCOVERY_SETUP_KEY = "pendingDiscoverySetup";',
);
const HANDOFF_SECTION_END = statusHandoffJs.indexOf(
  "function resetPostAccessBootstrap()",
  HANDOFF_SECTION_START,
);

if (HANDOFF_SECTION_START === -1 || HANDOFF_SECTION_END === -1) {
  throw new Error(
    "Could not isolate the discovery handoff section from discovery-status-handoff.js",
  );
}

const handoffSource = statusHandoffJs.slice(
  HANDOFF_SECTION_START,
  HANDOFF_SECTION_END,
);

function createStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}

function createHandoffHarness({
  search = "",
  onboardingVisible = false,
  onCheckOnboardingGate = null,
} = {}) {
  const sessionStorage = createStorage();
  const historyCalls = [];
  const openCalls = [];
  const context = vm.createContext({
    console,
    URLSearchParams,
    sessionStorage,
    window: {
      location: {
        search,
        pathname: "/index.html",
        hash: "",
      },
    },
    history: {
      replaceState(_state, _title, path) {
        historyCalls.push(path);
        const queryStart = path.indexOf("?");
        const hashStart = path.indexOf("#");
        if (queryStart === -1) {
          context.window.location.search = "";
          return;
        }
        const queryEnd = hashStart === -1 ? path.length : hashStart;
        context.window.location.search = path.slice(queryStart, queryEnd);
      },
    },
    __onboardingVisible: onboardingVisible,
    __checkOnboardingGateCalls: 0,
    postAccessBootstrapDone: false,
    postAccessBootstrapPromise: Promise.resolve(),
    isOnboardingWizardVisible() {
      return context.__onboardingVisible;
    },
    isFirstRunWizardVisible() {
      return false;
    },
    async openDiscoverySetupWizard(options) {
      openCalls.push(options);
    },
    getDiscoveryWizardRecommendedFlow() {
      return "local_agent";
    },
    getDiscoveryReadinessSnapshot() {
      return { recommendedFlow: "local_agent" };
    },
    async checkInfraSetupGate() {
      return false;
    },
    async checkOnboardingGate() {
      context.__checkOnboardingGateCalls += 1;
      if (typeof onCheckOnboardingGate === "function") {
        await onCheckOnboardingGate(context);
      }
    },
  });

  context.__hostApi = {
    isOnboardingWizardVisible() {
      return context.__onboardingVisible;
    },
    isFirstRunWizardVisible() {
      return context.isFirstRunWizardVisible();
    },
    openDiscoverySetupWizard(options) {
      openCalls.push(options);
    },
    getDiscoveryWizardRecommendedFlow() {
      return "local_agent";
    },
    getDiscoveryReadinessSnapshot() {
      return { recommendedFlow: "local_agent" };
    },
    checkInfraSetupGate() {
      return context.checkInfraSetupGate();
    },
    checkOnboardingGate() {
      return context.checkOnboardingGate();
    },
  };

  const handoffPreamble = `
function host() {
  return __hostApi;
}
function runTracker() {
  return {
    getState() {
      return {};
    },
    isActive() {
      return false;
    },
  };
}
function configCore() {
  return {};
}
`;

  vm.runInContext(handoffPreamble + handoffSource, context, {
    filename: "discovery-status-handoff.js#discovery-cold-start-handoffs",
  });

  return {
    context,
    sessionStorage,
    historyCalls,
    openCalls,
    async run(source) {
      return vm.runInContext(source, context);
    },
  };
}

describe("Discovery cold-start handoffs", () => {
  it("requestDiscoverySetup defers discovery while onboarding is visible", async () => {
    const harness = createHandoffHarness({ onboardingVisible: true });

    const result = await harness.run(
      'requestDiscoverySetup({ entryPoint: "starter_sheet_created" })',
    );

    assert.equal(result.deferred, true);
    assert.equal(
      harness.sessionStorage.getItem("pendingDiscoverySetup"),
      "1",
      "should queue the deferred discovery handoff",
    );
    assert.deepEqual(harness.openCalls, []);
  });

  it("requestDiscoverySetup can open immediately for explicit discovery entry points", async () => {
    const harness = createHandoffHarness({ onboardingVisible: true });

    const result = await harness.run(
      'requestDiscoverySetup({ entryPoint: "toolbar", allowWhileOnboarding: true })',
    );

    assert.equal(result.deferred, false);
    assert.equal(harness.sessionStorage.getItem("pendingDiscoverySetup"), null);
    assert.equal(harness.openCalls.length, 1);
    assert.equal(harness.openCalls[0].entryPoint, "toolbar");
  });

  it("handleDiscoverySetupDeepLink strips the query param while deferring onboarding-first flows", async () => {
    const harness = createHandoffHarness({
      search: "?setup=discovery&sheet=abc123",
      onboardingVisible: true,
    });

    const handled = await harness.run("handleDiscoverySetupDeepLink()");

    assert.equal(handled, true);
    assert.equal(
      harness.sessionStorage.getItem("pendingDiscoverySetup"),
      "1",
      "should preserve the deferred discovery intent",
    );
    assert.deepEqual(harness.openCalls, []);
    assert.deepEqual(harness.historyCalls, ["/index.html?sheet=abc123"]);
  });

  it("resumePendingDiscoverySetupIfNeeded consumes the handoff exactly once", async () => {
    const harness = createHandoffHarness();
    harness.sessionStorage.setItem("pendingDiscoverySetup", "1");

    const first = await harness.run("resumePendingDiscoverySetupIfNeeded()");
    const second = await harness.run("resumePendingDiscoverySetupIfNeeded()");

    assert.equal(first, true);
    assert.equal(second, false);
    assert.equal(harness.sessionStorage.getItem("pendingDiscoverySetup"), null);
    assert.equal(harness.openCalls.length, 1);
    assert.equal(harness.openCalls[0].entryPoint, "settings");
  });

  it("runPostAccessBootstrapOnce checks onboarding before processing the discovery deep link and stays one-shot", async () => {
    const harness = createHandoffHarness({
      search: "?setup=discovery",
      onCheckOnboardingGate(context) {
        context.__onboardingVisible = true;
      },
    });

    await harness.run("runPostAccessBootstrapOnce()");
    await harness.run("runPostAccessBootstrapOnce()");

    assert.equal(harness.context.__checkOnboardingGateCalls, 1);
    assert.equal(
      harness.sessionStorage.getItem("pendingDiscoverySetup"),
      "1",
      "should defer only after onboarding has been surfaced",
    );
    assert.deepEqual(harness.openCalls, []);
    assert.deepEqual(harness.historyCalls, ["/index.html"]);
  });

  it("starter-sheet creation routes through the shared deferred discovery helper", () => {
    const fnStart = setupJs.indexOf("async function handleSetupCreateStarterSheet");
    const fnEnd = setupJs.indexOf("function initSetupAndSheetAccessActions", fnStart);
    const fnBody = setupJs.slice(fnStart, fnEnd);

    assert.ok(
      fnBody.includes("await host().runPostAccessBootstrapOnce()"),
      "starter-sheet handoff should wait for onboarding bootstrap sequencing",
    );
    assert.ok(
      fnBody.includes(
        'await host().requestDiscoverySetup({ entryPoint: "starter_sheet_created" })',
      ),
      "starter-sheet handoff should use the shared discovery deferral helper",
    );
    assert.ok(
      !fnBody.includes(
        'await openDiscoverySetupWizard({ entryPoint: "starter_sheet_created" })',
      ),
      "starter-sheet handoff should not bypass onboarding by opening the wizard directly",
    );
  });
});
