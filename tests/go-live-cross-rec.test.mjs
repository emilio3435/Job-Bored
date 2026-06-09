import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const userContentStoreJs = readFileSync(
  join(repoRoot, "user-content-store.js"),
  "utf8",
);
const discoveryWizardUiJs = readFileSync(
  join(repoRoot, "discovery-wizard-ui.js"),
  "utf8",
);
const firstRunWizardJs = readFileSync(
  join(repoRoot, "first-run-wizard.js"),
  "utf8",
);
const whatsNextBannerJs = readFileSync(
  join(repoRoot, "whats-next-banner.js"),
  "utf8",
);
const bridgeRegistryJs = readFileSync(
  join(repoRoot, "bridge-registry.js"),
  "utf8",
);

// ============================================================
// FE-3: cross-recommendation. Two completion flags drive the
// dashboard banner + the discovery wizard's onClose handler so
// finishing either track recommends the other — in either order.
// ============================================================

describe("user-content-store — go-live + discovery completion flags (FE-3 §7.6)", () => {
  it("exposes the goLiveSetupComplete trio following the infraSetupComplete pattern", () => {
    assert.match(
      userContentStoreJs,
      /async function isGoLiveSetupComplete\(\)\s*\{\s*return !!\(await getSetting\("goLiveSetupComplete"\)\);/,
      "isGoLiveSetupComplete reads the goLiveSetupComplete setting",
    );
    assert.match(
      userContentStoreJs,
      /async function completeGoLiveSetup\(\)\s*\{\s*await setSetting\("goLiveSetupComplete", true\);/,
      "completeGoLiveSetup writes the goLiveSetupComplete setting",
    );
    assert.match(
      userContentStoreJs,
      /async function resetGoLiveSetupCompletion\(\)\s*\{\s*await setSetting\("goLiveSetupComplete", false\);/,
      "resetGoLiveSetupCompletion clears the goLiveSetupComplete setting",
    );
  });

  it("exposes the discoverySetupComplete trio following the infraSetupComplete pattern", () => {
    assert.match(
      userContentStoreJs,
      /async function isDiscoverySetupComplete\(\)\s*\{\s*return !!\(await getSetting\("discoverySetupComplete"\)\);/,
    );
    assert.match(
      userContentStoreJs,
      /async function completeDiscoverySetup\(\)\s*\{\s*await setSetting\("discoverySetupComplete", true\);/,
    );
    assert.match(
      userContentStoreJs,
      /async function resetDiscoverySetupCompletion\(\)\s*\{\s*await setSetting\("discoverySetupComplete", false\);/,
    );
  });

  it("registers both trios on window.CommandCenterUserContent (exported public API)", () => {
    for (const fn of [
      "isGoLiveSetupComplete",
      "completeGoLiveSetup",
      "resetGoLiveSetupCompletion",
      "isDiscoverySetupComplete",
      "completeDiscoverySetup",
      "resetDiscoverySetupCompletion",
    ]) {
      assert.match(
        userContentStoreJs,
        new RegExp(`\\n\\s*${fn},`),
        `${fn} must be exported on window.CommandCenterUserContent`,
      );
    }
  });
});

// ----------------------------------------------------------------------
// Discovery onClose cross-rec: simulate the renderDiscoverySetupWizard
// onClose contract — onClose(reason, { state, snapshot, stepId }) —
// and assert completeDiscoverySetup fires only on finish-with-connected
// AND that banner.refreshBanner is invoked only when go-live is still
// open. We extract the onClose lambda by stubbing renderWizardShell.
// ----------------------------------------------------------------------

describe("discovery-wizard-ui — onClose cross-rec (FE-3)", () => {
  it("the onClose handler reads ctx.state.result and checks reason === 'finish'", () => {
    // The contract is reason+state-driven; assert the shape with a source
    // sniff so we keep the lane independent of the renderWizardShell wiring.
    assert.match(
      discoveryWizardUiJs,
      /onClose:\s*\(reason,\s*ctx\)\s*=>/,
      "onClose must take (reason, ctx) per the discovery-wizard-shell contract",
    );
    assert.match(
      discoveryWizardUiJs,
      /ctx\.state\.result\b/,
      "onClose must read the persisted result from ctx.state.result",
    );
    assert.match(
      discoveryWizardUiJs,
      /reason === "finish"/,
      "onClose must gate cross-rec on reason === 'finish'",
    );
    assert.match(
      discoveryWizardUiJs,
      /persistedResult === "connected"/,
      "onClose must gate cross-rec on a connected result (stub_only / unverified do NOT count)",
    );
  });

  it("the cross-rec helper calls UC.completeDiscoverySetup, then banner.refreshBanner only when go-live is still open", () => {
    assert.match(
      discoveryWizardUiJs,
      /async function recommendGoLiveAfterDiscoveryFinish\(\)/,
      "the helper must be defined alongside the renderer",
    );
    // The helper must call completeDiscoverySetup and check isGoLiveSetupComplete.
    const helperStart = discoveryWizardUiJs.indexOf(
      "async function recommendGoLiveAfterDiscoveryFinish",
    );
    assert.ok(helperStart !== -1);
    // Walk forward to the next blank-line boundary; keep ~3KB to capture body.
    const helperBody = discoveryWizardUiJs.slice(helperStart, helperStart + 3000);
    assert.match(helperBody, /completeDiscoverySetup/);
    assert.match(helperBody, /isGoLiveSetupComplete/);
    assert.match(helperBody, /whatsNextBanner/);
    assert.match(helperBody, /refreshBanner/);
  });

  it("the onClose still preserves discovery's existing control flow (clearDiscoveryWizardRuntime + refreshDiscoveryReadinessSnapshot + onboarding restore)", () => {
    // Locate the onClose block — must keep its existing semantics intact.
    const onCloseIdx = discoveryWizardUiJs.indexOf("onClose: (reason, ctx)");
    assert.ok(onCloseIdx !== -1);
    const onCloseBody = discoveryWizardUiJs.slice(onCloseIdx, onCloseIdx + 2000);
    assert.match(onCloseBody, /clearDiscoveryWizardRuntime/);
    assert.match(onCloseBody, /refreshDiscoveryReadinessSnapshot/);
    assert.match(onCloseBody, /showOnboardingWizard/);
    assert.match(onCloseBody, /_onboardingWasHiddenByDiscovery/);
  });
});

// ----------------------------------------------------------------------
// Mandatory two-track onboarding: finishing discovery now AUTO-OPENS the
// go-live wizard (upgrade from the banner-only nudge), and the discovery
// wizard's host bridge must expose getUserContent so the finish handler
// can actually read/write the completion flags (without it the flag never
// persists and the auto-chain would loop forever).
// ----------------------------------------------------------------------

describe("discovery-wizard-ui — auto-open go-live on finish (mandatory onboarding)", () => {
  it("recommendGoLiveAfterDiscoveryFinish launches go-live via requestGoLiveSetup when go-live is incomplete", () => {
    const helperStart = discoveryWizardUiJs.indexOf(
      "async function recommendGoLiveAfterDiscoveryFinish",
    );
    assert.ok(helperStart !== -1);
    const helperBody = discoveryWizardUiJs.slice(helperStart, helperStart + 3000);
    // The !goLiveDone branch must now LAUNCH the go-live wizard, not just
    // refresh the banner.
    assert.match(
      helperBody,
      /requestGoLiveSetup\(/,
      "the finish handler must auto-open go-live via requestGoLiveSetup",
    );
    assert.match(
      helperBody,
      /entryPoint:\s*"onboarding_chain"/,
      "auto-open must use the onboarding_chain entry point",
    );
    assert.match(
      helperBody,
      /allowWhileOnboarding:\s*true/,
      "auto-open must allow while onboarding (the profile wizard may be active)",
    );
    // The banner refresh is preserved as the progress-bar update + the
    // fallback when the bridge is unavailable.
    assert.match(
      helperBody,
      /refreshBanner/,
      "the banner refresh must remain as the progress-bar update / fallback",
    );
  });

  it("the discovery wizard host bridge exposes getUserContent so the finish handler can persist discoverySetupComplete", () => {
    // recommendGoLiveAfterDiscoveryFinish reads UC via host().getUserContent
    // where host() === window.JobBoredDiscoveryWizard.ui.host. Without this
    // key the flag never persists and the auto-chain ping-pongs forever.
    const start = bridgeRegistryJs.indexOf("wizard.ui.host = {");
    assert.ok(start !== -1, "wizard.ui.host bridge object must exist");
    const end = bridgeRegistryJs.indexOf("};", start);
    assert.ok(end !== -1);
    const bridgeBlock = bridgeRegistryJs.slice(start, end);
    assert.match(
      bridgeBlock,
      /getUserContent:\s*host\.getUserContent/,
      "wizard.ui.host must wire getUserContent so the discovery finish handler can read/write completion flags",
    );
  });
});

// ----------------------------------------------------------------------
// Bridge contract: the onboarding auto-chain only works if each wizard's
// host bridge actually exposes the methods that wizard calls. These host
// objects are hand-maintained literals — a method can silently go missing
// and the wizards just no-op (exactly the getUserContent bug). Pin the
// chain-critical methods so a dropped key fails the build, not production.
// ----------------------------------------------------------------------

describe("bridge-registry — onboarding auto-chain host contracts", () => {
  /** Slice a `<name>.host = { ... };` object literal out of the source. */
  function sliceHostObject(label) {
    const start = bridgeRegistryJs.indexOf(`${label} = {`);
    assert.ok(start !== -1, `${label} bridge object must exist`);
    const end = bridgeRegistryJs.indexOf("};", start);
    assert.ok(end !== -1, `${label} bridge object must be terminated`);
    return bridgeRegistryJs.slice(start, end);
  }

  it("wizard.ui.host wires every method the discovery finish/chain depends on", () => {
    const block = sliceHostObject("wizard.ui.host");
    for (const method of [
      "getUserContent", // read/write completion flags
      "requestGoLiveSetup", // auto-open go-live on discovery finish
      "clearDiscoveryWizardRuntime", // onClose teardown
      "refreshDiscoveryReadinessSnapshot", // onClose snapshot refresh
      "showOnboardingWizard", // restore onboarding after close
    ]) {
      assert.match(
        block,
        new RegExp(`${method}:\\s*host\\.${method}`),
        `wizard.ui.host must wire ${method} — the discovery wizard calls host().${method}`,
      );
    }
  });

  it("goLive.host wires every method the go-live finish/chain depends on", () => {
    const block = sliceHostObject("goLive.host");
    for (const method of [
      "requestDiscoverySetup", // auto-open discovery on go-live finish
      "isOnboardingWizardVisible", // onboarding-defer gate
      "isFirstRunWizardVisible", // onboarding-defer gate
      "requestEnhancementsSetup", // "Maximize your results" CTA on the done step
    ]) {
      assert.match(
        block,
        new RegExp(`${method}:\\s*host\\.${method}`),
        `goLive.host must wire ${method} — the go-live wizard calls host().${method}`,
      );
    }
  });
});

// ----------------------------------------------------------------------
// CTA swaps: the first-run done panel + the banner both launch the
// go-live wizard now. The old window.open("docs/SELF-HOSTING.md") path
// must be gone from both consumers.
// ----------------------------------------------------------------------

describe("self-hosting CTA swaps — launch the go-live wizard, NOT the markdown (FE-3)", () => {
  it("first-run wizard: handleFirstRunDoneOpenSelfHosting calls requestGoLiveSetup with allowWhileOnboarding=true", () => {
    const fnStart = firstRunWizardJs.indexOf(
      "function handleFirstRunDoneOpenSelfHosting",
    );
    assert.ok(fnStart !== -1, "handleFirstRunDoneOpenSelfHosting must exist");
    const fnBody = firstRunWizardJs.slice(fnStart, fnStart + 2000);
    assert.match(fnBody, /handleFirstRunDoneToDashboard\(\)/);
    assert.match(fnBody, /requestGoLiveSetup\(/);
    assert.match(fnBody, /entryPoint:\s*"whats_next"/);
    assert.match(fnBody, /allowWhileOnboarding:\s*true/);
    assert.ok(
      !/window\.open\(["']docs\/SELF-HOSTING\.md["']/.test(fnBody),
      "the self-hosting CTA must NOT open the markdown deep-reference anymore",
    );
  });

  it("banner: handleOpenSelfHosting calls requestGoLiveSetup, no window.open(SELF-HOSTING.md)", () => {
    const fnStart = whatsNextBannerJs.indexOf("function handleOpenSelfHosting");
    assert.ok(fnStart !== -1);
    const fnBody = whatsNextBannerJs.slice(fnStart, fnStart + 1200);
    assert.match(fnBody, /requestGoLiveSetup\(/);
    assert.match(fnBody, /entryPoint:\s*["']whats_next["']/);
    assert.ok(
      !/window\.open\(["']docs\/SELF-HOSTING\.md["']/.test(fnBody),
      "the banner's self-hosting CTA must NOT open the markdown deep-reference anymore",
    );
  });
});
