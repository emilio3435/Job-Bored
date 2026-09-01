import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

/* ============================================================
   ONEFLOW L7 — the sweep (spec §7 deletions table, §10 Phase 4).

   WHY a source-level suite: §7's acceptance is "deletions table
   empty". A behavior probe can show the one flow works; only reading
   the repo can show the SECOND onboarding is gone. A stranger cloning
   this repo must find one onboarding, not two, so every claim here is
   about what the tree no longer contains — and each is paired with the
   replacement that carries the deleted surface's job, so nothing is
   deleted without somewhere for the user to go.
   ============================================================ */

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(root, rel), "utf8");
const gone = (rel) =>
  assert.equal(existsSync(join(root, rel)), false, `${rel} must be deleted`);

/**
 * Every shipped browser source + markup file in the repo root, plus the
 * partials and css dirs. Used for repo-wide "this is gone" claims: a
 * file-scoped grep cannot prove a deletion when the file it named is
 * itself deleted.
 */
function shippedSources() {
  const out = [];
  const dirs = ["", "partials", "css", "scripts/lib"];
  for (const dir of dirs) {
    for (const name of readdirSync(join(root, dir), { withFileTypes: true })) {
      if (!name.isFile()) continue;
      if (!/\.(js|mjs|html|css|json)$/.test(name.name)) continue;
      if (name.name === "config.js" || name.name === "package-lock.json") continue;
      const rel = dir ? `${dir}/${name.name}` : name.name;
      out.push([rel, read(rel)]);
    }
  }
  return out;
}

/** True when `needle` appears outside of a pure comment line. */
function source_has(source, needle) {
  return String(source)
    .split("\n")
    .some(
      (line) => line.includes(needle) && !/^\s*(\/\/|\*|\/\*)/.test(line),
    );
}

describe("§7 · the enhancements wizard is gone (all 5 steps)", () => {
  it("the module and its suite are deleted", () => {
    gone("enhancements-wizard-ui.js");
    gone("tests/enhancements-wizard.test.mjs");
  });

  it("index.html carries neither its mount nor its script tag", () => {
    const html = read("index.html");
    assert.equal(/enhancementsWizardMount/.test(html), false);
    assert.equal(/enhancements-wizard-ui\.js/.test(html), false);
  });

  it("package.json no longer syntax-checks a file that does not exist", () => {
    assert.equal(
      /enhancements-wizard-ui\.js/.test(read("package.json")),
      false,
    );
  });

  it("no caller is left holding a dead handle", () => {
    for (const file of [
      "app.js",
      "app-compat.js",
      "bridge-registry.js",
      "go-live-wizard-ui.js",
      "eslint.config.mjs",
    ]) {
      const source = read(file);
      assert.equal(
        /requestEnhancementsSetup|JobBoredEnhancements|openEnhancementsWizard/.test(
          source,
        ),
        false,
        `${file} must not reach for the retired wizard`,
      );
    }
  });

  it("the go-live done step no longer offers the retired CTA", () => {
    const source = read("go-live-wizard-ui.js");
    assert.equal(/Maximize your results/.test(source), false);
    assert.equal(/go_live_open_enhancements/.test(source), false);
  });

  it("the three *EnhancementDismissed flags leave the store", () => {
    const store = read("user-content-store.js");
    for (const flag of [
      "serpApiEnhancementDismissed",
      "geminiEnhancementDismissed",
      "aiProviderEnhancementDismissed",
    ]) {
      assert.equal(
        source_has(store, flag),
        false,
        `${flag} has no reader left — spec §7 deletes it`,
      );
    }
  });
});

describe("§7 · Settings → Upgrades carries what the wizard used to list", () => {
  const partial = () => read("partials/settings-modal.html");

  it("is a real tab: button, panel, and schema entry all present", () => {
    const html = partial();
    assert.match(html, /id="settings-tab-upgrades"/);
    assert.match(html, /data-tab-id="upgrades"/);
    assert.match(html, /id="settings-panel-upgrades"/);

    const schema = read("settings-tab-schema.js");
    assert.match(schema, /UPGRADES: "upgrades"/);
    assert.match(schema, /panelId: "settings-panel-upgrades"/);
    assert.match(schema, /buttonId: "settings-tab-upgrades"/);
  });

  it("lists the three more_optional cards the wizard's last step carried", () => {
    const html = partial();
    for (const title of ["ATS scoring", "Company logos", "Browser Use Cloud"]) {
      assert.ok(
        html.includes(title),
        `the Upgrades panel must still offer ${title}`,
      );
    }
    // Each card names WHERE to turn it on — and it has to be a place that
    // exists. The wizard's own pointers had rotted (there is no Settings →
    // General tab, and no Browser Use Cloud switch in Settings at all), so
    // the cards carry the real switches, not the fossil route (§7 fossils).
    assert.match(html, /Turn on: Settings → ATS Scoring\./);
    assert.match(html, /logoDevToken/);
    assert.match(html, /BROWSER_USE_API_KEY/);
    assert.equal(/Settings → General/.test(html), false);
    assert.equal(/Settings → Job Discovery/.test(html), false);
  });

  it("B6's footer line is not a lie — the power-ups it names live here", () => {
    // spec §5 B6: "More power-ups — URL import, grounded search, other
    // devices — live in Settings → Upgrades, each one click, none
    // required." The panel has to actually cover those three.
    const html = partial();
    assert.match(html, /URL import/);
    assert.match(html, /Grounded web search/i);
    assert.match(html, /Other devices/i);
    // Both Gemini-powered ones point at the key that unlocks them.
    assert.match(html, /Settings → AI Providers → Gemini API key/);
    assert.match(read("oneflow-beat-payoff.js"), /Settings → Upgrades/);
  });

  it("stays static — no JS module was resurrected to render it", () => {
    assert.equal(existsSync(join(root, "upgrades-card.js")), false);
  });
});

describe("§7 · the blocking discovery gate is gone", () => {
  it("nothing anywhere in the tree markup or drives it", () => {
    // Its markup lived in partials/onboarding-wizard.html and its driver in
    // onboarding-wizard.js — both deleted outright further down §7 — so the
    // claim is repo-wide rather than file-scoped.
    for (const [file, source] of shippedSources()) {
      for (const needle of [
        "discoverySetupGate",
        "discoveryGateOpenWizard",
        "discoveryGateSkipEscape",
        "showDiscoveryGate",
        "hideDiscoveryGate",
      ]) {
        assert.equal(
          source.includes(needle),
          false,
          `${file} must not reach for the deleted gate (${needle})`,
        );
      }
    }
  });

  it("discoverySetupSkipped SURVIVES — the banner still reads it", () => {
    // Deliberately kept (spec §7 deletes the gate, not the flag): the
    // what's-next banner exposes it as an observable fact, and deleting a
    // store key a live reader calls is how a sweep breaks a dashboard.
    const store = read("user-content-store.js");
    for (const fn of [
      "isDiscoverySetupSkipped",
      "setDiscoverySetupSkipped",
      "resetDiscoverySetupSkipped",
    ]) {
      assert.ok(store.includes(fn), `${fn} must stay on the store`);
    }
    assert.match(read("whats-next-banner.js"), /isDiscoverySetupSkipped/);
  });

  it("B5 is what replaced it: required fuel, skippable connect", () => {
    // spec §5 B5 — the gate blocked on the whole setup; the beat blocks on
    // the fuel key only, and its skip is connect-only.
    const beat = read("oneflow-beat-discovery.js");
    assert.match(beat, /discoveryConnect/, "the skip is scoped to connect");
    assert.match(
      beat,
      /Skip the connection for now/,
      "the spec's skip copy, verbatim",
    );
  });
});

describe("§7 · the first-run infra wizard is gone", () => {
  it("module, partial, CSS and every suite that pinned it are deleted", () => {
    gone("first-run-wizard.js");
    gone("partials/first-run-wizard.html");
    gone("css/legacy-first-run-wizard.css");
    for (const suite of [
      "tests/first-run-wizard.test.mjs",
      "tests/first-run-wizard-provider-picker.test.mjs",
      "tests/first-run-wizard-sheet-step-interactive.test.mjs",
      "tests/first-run-wizard-create-stays-in-flow.test.mjs",
      "tests/first-run-wizard-create-resume-stays-in-flow.test.mjs",
      "tests/whats-next-signpost.test.mjs",
    ]) {
      gone(suite);
    }
  });

  it("index.html drops the include, the script tag and the stylesheet", () => {
    const html = read("index.html");
    assert.equal(/first-run-wizard\.(js|html|css)/.test(html), false);
    assert.equal(/legacy-first-run-wizard/.test(html), false);
  });

  it("no surviving module reaches for it", () => {
    for (const file of [
      "app.js",
      "app-compat.js",
      "bridge-registry.js",
      "sheet-access-setup.js",
      "materials-feature.js",
      "discovery-status-handoff.js",
      "go-live-wizard-ui.js",
      "oneflow-beat-google.js",
      "package.json",
      "scripts/lib/index-protected-surface.mjs",
    ]) {
      assert.equal(
        /firstRunWizard|FirstRunWizard|checkInfraSetupGate/.test(read(file)),
        false,
        `${file} must not reach for the retired first-run wizard`,
      );
    }
  });

  it("B1 keeps its sheet checker — moved, not deleted", () => {
    // oneflow-beat-google.js called firstRunWizard.verifyExistingSheetAccess
    // to verify a pasted sheet. It is the one piece of the wizard the flow
    // still needs, so it moved to the module that survives and already owns
    // the gate + starter-sheet creator (spec §7: "Beat 1 owns sheet
    // creation"). Deleting it would have made B1's paste path dead.
    const setup = read("sheet-access-setup.js");
    assert.match(setup, /async function verifyExistingSheetAccess\(/);
    assert.match(setup, /verifyExistingSheetAccess,/, "and it is exported");
    assert.match(
      read("oneflow-beat-google.js"),
      /verifyExistingSheetAccess/,
      "B1 reads it from its new home",
    );
  });

  it("the Settings reset buttons reopen the ONE flow, not a deleted wizard", () => {
    const materials = read("materials-feature.js");
    assert.match(materials, /JobBoredOneFlow/);
    assert.equal(/reopenFirstRunWizard|hideFirstRunWizard/.test(materials), false);
  });
});

describe("§7 · the legacy onboarding wizard is gone; the player survives", () => {
  it("module, partial, CSS and its suites are deleted", () => {
    gone("onboarding-wizard.js");
    gone("partials/onboarding-wizard.html");
    gone("css/legacy-onboarding.css");
    gone("tests/onboarding-profile-persistence.test.mjs");
    gone("tests/onboarding-celebration.test.mjs");
  });

  it("onboarding-celebration.js STAYS — it is the one celebration", () => {
    // spec §7 collapses four bursts to one; the player itself is what B6
    // reuses, so it is the file the sweep protects, not the file it deletes.
    assert.ok(existsSync(join(root, "onboarding-celebration.js")));
    assert.ok(existsSync(join(root, "tests/oneflow-l4-celebration.test.mjs")));
  });

  it("the four legacy stage configs are gone; only the flow finale remains", () => {
    const player = read("onboarding-celebration.js");
    for (const stage of ["profile:", "discovery:", "devices:", "bonus:"]) {
      assert.equal(
        player.includes(stage),
        false,
        `stage ${stage} was a "done" moment before a single job existed (§7)`,
      );
    }
    assert.match(player, /flow_payoff:/, "B6's finale is the only stage left");
  });

  it("exactly ONE call site plays the celebration (§10 Phase 1 acceptance)", () => {
    const callers = [];
    for (const file of [
      "oneflow-beat-payoff.js",
      "discovery-wizard-ui.js",
      "go-live-wizard-ui.js",
      "materials-feature.js",
      "app.js",
      "app-compat.js",
      "auth-session.js",
      "bridge-registry.js",
    ]) {
      const hits = read(file).match(/\.playOnboardingCelebration\(/g);
      if (hits) callers.push(`${file}×${hits.length}`);
    }
    assert.deepEqual(
      callers,
      ["oneflow-beat-payoff.js×1"],
      "B6 is the only celebration; the delegating alias is gone with its wizard",
    );
  });

  it("no surviving module reaches for the deleted wizard", () => {
    for (const file of [
      "app.js",
      "app-compat.js",
      "bridge-registry.js",
      "auth-session.js",
      "materials-feature.js",
      "discovery-wizard-ui.js",
      "discovery-status-handoff.js",
      "go-live-wizard-ui.js",
      "index.html",
      "package.json",
      "scripts/lib/index-protected-surface.mjs",
    ]) {
      assert.equal(
        /onboardingWizard|OnboardingWizard|checkOnboardingGate/.test(read(file)),
        false,
        `${file} must not reach for the retired onboarding wizard`,
      );
    }
  });

  it("the re-entry points that used to open it now open the ONE flow", () => {
    // "Resume onboarding" in the account menu and both Settings reset
    // buttons: the capability survives the surface (spec §3.4 — the flow's
    // own open() is the explicit re-entry API).
    assert.match(read("auth-session.js"), /JobBoredOneFlow/);
    assert.match(read("materials-feature.js"), /JobBoredOneFlow/);
  });
});

describe('§7 · #setupScreen ("One more step.") is gone', () => {
  it("the markup, and the duplicate headline it carried, leave index.html", () => {
    const html = read("index.html");
    assert.equal(/id="setupScreen"/.test(html), false);
    assert.equal(/setupCreateStarterSheetBtn/.test(html), false);
    // The fossil §7 names: two surfaces both headlined "One more step."
    assert.equal(/One more step\./.test(html), false);
  });

  it("nothing shows, hides, or paints a screen that does not exist", () => {
    for (const [file, source] of shippedSources()) {
      for (const needle of [
        "setupScreen",
        "revealPipelineSetupStepsScreen",
        "renderSetupStarterSheetUi",
      ]) {
        assert.equal(
          source.includes(needle),
          false,
          `${file} must not reach for the deleted setup screen (${needle})`,
        );
      }
    }
  });

  it("the starter-sheet CREATOR stays — Beat 1 calls it", () => {
    // spec §7: "#setupScreen — Delete; B1 owns sheet creation." The screen
    // is the fossil; the creation path behind it is what B1 drives.
    const setup = read("sheet-access-setup.js");
    assert.match(setup, /async function handleSetupCreateStarterSheet\(/);
    assert.match(setup, /async function createBlankStarterSheet\(/);
    assert.match(setup, /handleSetupCreateStarterSheet,/, "still exported");
    assert.match(
      read("oneflow-beat-google.js"),
      /handleSetupCreateStarterSheet/,
      "B1 is the caller that keeps it alive",
    );
  });

  it("the gate's error mode stays — a broken config still gets an honest screen", () => {
    const setup = read("sheet-access-setup.js");
    assert.match(setup, /mode === "error"/);
    assert.match(read("app-bootstrap.js"), /sheetAccessGateIsInErrorMode/);
  });

  it("signed-in-with-no-sheet routes to Beat 1, not to a deleted screen", () => {
    const setup = read("sheet-access-setup.js");
    const fnIdx = setup.indexOf("function revealSetupScreenAfterAuth()");
    assert.notEqual(fnIdx, -1, "the entry point auth-session calls must survive");
    const body = setup.slice(fnIdx, fnIdx + 1200);
    assert.match(body, /JobBoredOneFlow/, "it hands off to the flow");
    assert.match(body, /open\("google"\)/, "specifically to Beat 1 (spec §5 B1)");
  });
});

describe("§7 · welcome.js keeps its empty state, loses its onboarding", () => {
  it("the 9-step machine, its storage, and its self-test are gone", () => {
    const source = read("welcome.js");
    for (const needle of [
      "RENDERERS",
      "validateStep",
      "persistToLegacyStores",
      "runSelfTest",
      "jb-v2-onboarding",
      "openConfirmDialog",
      "shouldShowOnboarding",
      "STEP_TITLES",
      "MASCOT_SAYS",
    ]) {
      assert.equal(
        source.includes(needle),
        false,
        `welcome.js must not carry ${needle} — §7 keeps only the empty state`,
      );
    }
  });

  it("mountEmpty and isFirstRunEmpty are what §7 keeps", () => {
    const source = read("welcome.js");
    assert.match(source, /function mountEmpty\(region\)/);
    assert.match(source, /function isFirstRunEmpty\(\)/);
    assert.match(
      source,
      /window\.JobBoredWelcome = \{\s*boot: boot,\s*mountEmpty: mountEmpty,\s*isFirstRunEmpty: isFirstRunEmpty,\s*\};/,
      "the public surface is exactly boot + the two kept functions",
    );
  });

  it("the empty card still delegates to every legacy control it names", () => {
    // Deleting the onboarding half must not cost the card its three ways
    // out — each one clicks a control the legacy app already owns.
    const source = read("welcome.js");
    assert.match(source, /ingestUrlInput/);
    assert.match(source, /ingestManualModalOpenBtn/);
    assert.match(source, /discoveryBtn/);
  });

  it("welcome.css keeps only what the card renders", () => {
    const css = read("welcome.css");
    for (const dead of [
      "jbw-progress",
      "jbw-step",
      "jbw-dialog",
      "jbw-opt",
      "jbw-slider",
      "jbw-say",
      "jbw-sheet-actions",
      'data-mode="onboarding"',
    ]) {
      assert.equal(
        css.includes(dead),
        false,
        `welcome.css must not style the deleted flow (${dead})`,
      );
    }
    for (const kept of [".jbw-empty", ".jbw-sample", ".jbw-btn", ".jbw-mascot"]) {
      assert.ok(css.includes(kept), `${kept} still renders`);
    }
  });

  it("WELCOME.md documents only what ships", () => {
    const doc = read("WELCOME.md");
    // The step spec §7 names: the nine-step table, the localStorage schema,
    // and the self-test walkthrough. Naming them once as deleted is fine;
    // documenting them as if a reader could use them is the defect.
    assert.equal(/^## 1\. Step list$/m.test(doc), false);
    assert.equal(/^## \d+\. Persistence schema/m.test(doc), false);
    assert.equal(/^## \d+\. Self-test$/m.test(doc), false);
    assert.equal(/Activate by appending/.test(doc), false);
    assert.match(doc, /first-run empty state/i);
    assert.match(
      doc,
      /ONE-FLOW-ONBOARDING-SPEC/,
      "and points a reader at the flow that replaced the rest",
    );
  });
});

describe("§7 · the five legacy discovery modals are gone", () => {
  it("partials/discovery-modals.html is deleted, include and all", () => {
    gone("partials/discovery-modals.html");
    assert.equal(/discovery-modals\.html/.test(read("index.html")), false);
  });

  it("no module opens, closes, or populates any of the five", () => {
    const dead = [
      "discoveryPathsModal",
      "discoverySetupGuideModal",
      "discoveryLocalTunnelModal",
      "cloudflareRelaySetupModal",
      "discoveryHelpModal",
    ];
    for (const [file, source] of shippedSources()) {
      for (const id of dead) {
        assert.equal(
          source.includes(id),
          false,
          `${file} must not reach for the deleted ${id}`,
        );
      }
    }
  });

  it("the ngrok + Cloudflare screens left the app for the docs (§11.2)", () => {
    const source = read("discovery-setup-modals.js");
    for (const fn of [
      "renderDiscoveryLocalTunnelSetupUi",
      "saveDiscoveryLocalTunnelSetup",
      "populateCloudflareRelaySetupModal",
      "applyCloudflareRelayWorkerUrl",
      "probeNgrokFromLocalApi",
      "probeTunnelStaleBadge",
    ]) {
      assert.equal(
        source.includes(fn),
        false,
        `${fn} drove a deleted screen — Tailscale is the only presented path`,
      );
    }
    // The decision it implements is written down where a stranger finds it.
    assert.match(read("docs/SELF-HOSTING.md"), /ngrok/i);
  });

  it("what SURVIVES the module is what never was a modal", () => {
    // spec §7 deletes the five modals and their copy — not the Apps Script
    // CORS remediation two other modules call, and not Settings' own
    // Test-webhook action. Deleting those would have broken live surfaces
    // §7 never names.
    const source = read("discovery-setup-modals.js");
    assert.match(source, /async function testDiscoveryWebhookFromSettings\(\)/);
    assert.match(source, /async function handleAppsScriptBrowserCorsFailure\(/);
    assert.match(read("discovery-run-orchestration.js"), /handleAppsScriptBrowserCorsFailure/);
    assert.match(read("discovery-wizard-ui.js"), /handleAppsScriptBrowserCorsFailure/);
  });
});

describe("§7 · the drawer's Connection section is one button", () => {
  const drawer = () => read("partials/discovery-drawer.html");

  it("offers a single `Open discovery setup`, not five competing paths", () => {
    const html = drawer();
    assert.match(html, /id="settingsDiscoveryOpenSetupBtn"/);
    assert.match(html, /Open discovery setup/);
    for (const id of [
      "settingsDiscoveryGuideBtn",
      "settingsDiscoveryLocalSetupBtn",
      "settingsDiscoveryRelayBtn",
      "settingsDiscoveryTailscaleBtn",
      "settingsDiscoveryPathsBtn",
      "settingsTunnelStaleBadge",
    ]) {
      assert.equal(
        html.includes(id),
        false,
        `${id} was one of the five paths §7 collapses`,
      );
    }
  });

  it("Test webhook stays — it is a diagnostic, not a sixth setup path", () => {
    assert.match(drawer(), /id="settingsDiscoveryTestBtn"/);
    assert.match(
      read("discovery-setup-modals.js"),
      /settingsDiscoveryTestBtn/,
      "and it is still wired",
    );
  });

  it("the one button opens the discovery wizard the beats also use", () => {
    const source = read("discovery-setup-modals.js");
    const fnIdx = source.indexOf("function initDiscoverySetupGuide()");
    assert.notEqual(fnIdx, -1);
    const body = source.slice(fnIdx, fnIdx + 2000);
    assert.match(body, /settingsDiscoveryOpenSetupBtn/);
    assert.match(body, /requestDiscoverySetup/);
    assert.match(body, /entryPoint: "settings"/);
  });
});

describe("§7 · dead elements, flags, and fossils", () => {
  it("#enhancementsReEntryBtn and the whats-next badges leave index.html", () => {
    const html = read("index.html");
    // The re-entry button had no handler in ANY module — orphan markup for a
    // wizard that is now deleted twice over.
    assert.equal(/enhancementsReEntryBtn/.test(html), false);
    // The two CTA badges had no writer and no stylesheet rule: hidden spans
    // that could never show anything.
    assert.equal(/whatsNextDiscoveryBadge/.test(html), false);
    assert.equal(/whatsNextGoLiveBadge/.test(html), false);
    assert.equal(/whats-next-banner__cta-badge/.test(html), false);
  });

  it("#onboardingWizardBtn's handler is gone from boot", () => {
    assert.equal(
      /onboardingWizardBtn/.test(read("app-bootstrap.js")),
      false,
      "it wired a button for a wizard that no longer exists",
    );
  });

  it("fitProfileOnboardingComplete is no longer written", () => {
    // A localStorage flag with no reader anywhere in the repo.
    for (const [file, source] of shippedSources()) {
      assert.equal(
        source.includes("fitProfileOnboardingComplete"),
        false,
        `${file} must not write a flag nothing reads`,
      );
    }
  });

  it("the pendingDiscoverySetup plumbing is gone — writer, resumer, exports", () => {
    for (const [file, source] of shippedSources()) {
      for (const needle of [
        "pendingDiscoverySetup",
        "PendingDiscoverySetup",
        "PENDING_DISCOVERY_SETUP_KEY",
      ]) {
        assert.equal(
          source.includes(needle),
          false,
          `${file} must not carry the pending-setup queue (${needle})`,
        );
      }
    }
  });

  it("the Settings jb-v2 claim is corrected — it is ON by default", () => {
    // index.html: `var on = stored !== "0"` — default on, only "0" opts out.
    assert.match(read("index.html"), /default on; only '0' opts out/);
    const partial = read("partials/settings-modal.html");
    assert.equal(/Off by default/.test(partial), false);
    assert.match(partial, /On by default; toggle anytime\./);
  });

  it('the "Task #6" fossil is gone from the fit-profile files', () => {
    for (const file of ["fit-profile.css", "fit-profile-backcompat.js"]) {
      assert.equal(
        /Task #6/.test(read(file)),
        false,
        `${file} names an internal task id a stranger cannot resolve`,
      );
    }
  });

  it('there is exactly one "One more step." headline left: none', () => {
    // §7's duplicate-headline fossil: #setupScreen and #discoverySetupGate
    // shipped the same words. Both surfaces are deleted.
    for (const [file, source] of shippedSources()) {
      assert.equal(
        source.includes("One more step"),
        false,
        `${file} still carries the duplicated headline`,
      );
    }
  });

  it("the login gate's no-oauth sub-wizard is gone — Beat 1 owns that path", () => {
    const html = read("index.html");
    for (const id of [
      "sheetAccessGateOAuthShell",
      "sheetAccessGateOAuthChoice",
      "sheetAccessGateOAuthWizard",
      "sheetAccessGateOAuthClientIdInput",
      "sheetAccessGateBtnCreateOAuth",
      "sheetAccessGateOAuthGcloudBtn",
    ]) {
      assert.equal(
        html.includes(id),
        false,
        `${id} duplicated Beat 1's own client-ID step`,
      );
    }
    assert.equal(
      /initLoginGateOAuthUi/.test(read("sheet-access-setup.js")),
      false,
      "and its driver goes with it",
    );
    // B1 is where that step lives, guide and all (spec §5 B1).
    const beat = read("oneflow-beat-google.js");
    assert.match(beat, /oneFlowOauthClientIdInput/);
    assert.match(beat, /mergeStoredConfigOverridePatch/);
    assert.match(beat, /applyOAuthClientChange/);
  });

  it("a no-oauth gate request still reaches a real surface", () => {
    // showSheetAccessGate("no-oauth") has live callers in auth-session.js and
    // sheets-read-load.js. With the sub-wizard deleted it has to hand off to
    // Beat 1 rather than paint an empty panel.
    const setup = read("sheet-access-setup.js");
    const fnIdx = setup.indexOf("function showSheetAccessGate(mode)");
    assert.notEqual(fnIdx, -1);
    const body = setup.slice(fnIdx, setup.indexOf("\n  }", fnIdx));
    assert.match(body, /mode === "no-oauth"/);
    assert.match(body, /handOffNoOauthToBeatOne\(\)/);
    // …and the hand-off actually opens Beat 1.
    const helperIdx = setup.indexOf("function handOffNoOauthToBeatOne()");
    assert.notEqual(helperIdx, -1);
    const helper = setup.slice(helperIdx, helperIdx + 900);
    assert.match(helper, /JobBoredOneFlow/);
    assert.match(helper, /open\("google"\)/);
    // Falling through when the flow is missing must leave honest copy, not
    // a blank panel where the sub-wizard used to be.
    assert.match(body, /needs a Google OAuth Client ID/);
  });
});
