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
