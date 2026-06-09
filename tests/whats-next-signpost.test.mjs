import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { readIndexHtml } from "../scripts/lib/expand-index-includes.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const userContentStoreJs = readFileSync(
  join(repoRoot, "user-content-store.js"),
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
const firstRunPartial = readFileSync(
  join(repoRoot, "partials", "first-run-wizard.html"),
  "utf8",
);
const indexHtml = readIndexHtml(repoRoot);
const packageJson = JSON.parse(
  readFileSync(join(repoRoot, "package.json"), "utf8"),
);

// ============================================================
// VAL-SIGN-001 + VAL-SIGN-002: progressive-disclosure signpost
// after the wizard's Finish step (in-wizard terminal panel +
// dismissible dashboard banner). The wizard stays a 2-step flow
// (FIRST_RUN_TOTAL_STEPS === 2); the done panel is a sibling of
// #firstRunPanelProvider and is NOT a member of FIRST_RUN_STEPS.
// ============================================================

// --- Source-shape gates ---------------------------------------------------

describe("user-content-store — whatsNextDismissed flag", () => {
  it("exposes getWhatsNextDismissed / setWhatsNextDismissed", () => {
    assert.match(
      userContentStoreJs,
      /async function getWhatsNextDismissed\(\)\s*\{\s*return !!\(await getSetting\("whatsNextDismissed"\)\);/,
      "getWhatsNextDismissed should read the whatsNextDismissed setting",
    );
    assert.match(
      userContentStoreJs,
      /async function setWhatsNextDismissed\(v\)\s*\{\s*await setSetting\("whatsNextDismissed", !!v\);/,
      "setWhatsNextDismissed should write the whatsNextDismissed setting (coerced to bool)",
    );
  });

  it("registers the new helpers on the public API surface", () => {
    assert.match(
      userContentStoreJs,
      /\n\s*getWhatsNextDismissed,\n\s*setWhatsNextDismissed,/,
      "both helpers must be exported on window.CommandCenterUserContent",
    );
  });
});

describe("first-run wizard — 2-step invariant preserved (VAL-SIGN-001)", () => {
  it("FIRST_RUN_TOTAL_STEPS stays at 2 (the done panel is NOT a numbered step)", () => {
    assert.match(
      firstRunWizardJs,
      /const FIRST_RUN_TOTAL_STEPS = FIRST_RUN_STEPS\.length;/,
      "FIRST_RUN_TOTAL_STEPS must be derived from FIRST_RUN_STEPS.length",
    );
    // The done panel id (#firstRunPanelDone) MUST NOT appear inside
    // FIRST_RUN_STEPS — adding it would silently convert the wizard
    // into a 3-step flow and break the "Step N of 2" indicator.
    const stepsStart = firstRunWizardJs.indexOf(
      "const FIRST_RUN_STEPS = [",
    );
    const stepsEnd = firstRunWizardJs.indexOf(
      "];",
      stepsStart,
    );
    assert.ok(stepsStart !== -1 && stepsEnd !== -1, "must isolate FIRST_RUN_STEPS array");
    const stepsBlock = firstRunWizardJs.slice(stepsStart, stepsEnd);
    assert.ok(
      !/firstRunPanelDone/.test(stepsBlock),
      "the done panel must NOT be a member of FIRST_RUN_STEPS (it is a terminal confirmation, not a step)",
    );
    assert.match(stepsBlock, /firstRunPanelSheet/);
    assert.match(stepsBlock, /firstRunPanelProvider/);
  });

  it("the partial renders the done panel as a sibling AFTER #firstRunPanelProvider", () => {
    const providerIdx = firstRunPartial.indexOf('id="firstRunPanelProvider"');
    const doneIdx = firstRunPartial.indexOf('id="firstRunPanelDone"');
    assert.ok(providerIdx !== -1, "partial must still define #firstRunPanelProvider");
    assert.ok(doneIdx !== -1, "partial must define #firstRunPanelDone");
    assert.ok(
      doneIdx > providerIdx,
      "the done panel must come AFTER the provider panel in the markup",
    );
    // The done panel id must appear in the same flat structure (sibling of
    // the .first-run-wizard__inner) — it is NOT nested inside the
    // provider panel.
    const between = firstRunPartial.slice(providerIdx, doneIdx);
    // The first </div> after the provider panel id is its closing tag;
    // the done panel must come AFTER at least one such closing tag.
    const providerClose = between.indexOf("</div>");
    assert.ok(
      providerClose !== -1,
      "the provider panel must be closed (no nesting of the done panel inside it)",
    );
  });

  it("the done panel partial defines the two OPTIONAL CTAs + the primary 'Go to dashboard'", () => {
    // Isolate the done-panel block so the regex anchors don't pick up the
    // other primary CTAs (Create a starter sheet, Finish setup) elsewhere
    // in the partial.
    const doneStart = firstRunPartial.indexOf('id="firstRunPanelDone"');
    const doneEnd = firstRunPartial.indexOf("</div>\n      </div>\n    </div>", doneStart);
    assert.ok(doneStart !== -1, "done panel must exist");
    assert.ok(doneEnd !== -1, "done panel block must be isolatable");
    const doneBlock = firstRunPartial.slice(doneStart, doneEnd);
    // The primary "Continue setup" button uses the primary button class.
    // Class comes BEFORE id in the markup, so the regex anchors on the
    // button opening tag and reads "class=primary" then "id=GoToDashboard"
    // then the label. (Mandatory onboarding: this primary completion now
    // auto-launches discovery, so the label is "Continue setup", not the
    // old "Go to dashboard".)
    assert.match(
      doneBlock,
      /<button[\s\S]{0,300}?class="btn-modal-primary first-run-btn-block"[\s\S]{0,300}?id="firstRunDoneToDashboard"[\s\S]{0,200}?Continue setup/,
      "the primary completion button must use the primary button class",
    );
    // The two optional CTAs are clearly demoted (secondary button class).
    for (const ctaId of ["firstRunDoneOpenDiscovery", "firstRunDoneOpenSelfHosting"]) {
      assert.match(
        doneBlock,
        new RegExp(`<button[\\s\\S]{0,300}?btn-modal-secondary[\\s\\S]{0,300}?id="${ctaId}"`),
        `${ctaId} must use the secondary button class so it reads as OPTIONAL, not required`,
      );
    }
  });
});

describe("first-run wizard — finish shows terminal panel (VAL-SIGN-001)", () => {
  function loadWizardWithRecordingDom(hostStub) {
    const listeners = new Map();
    const docListeners = new Map();
    const els = new Map();
    const makeEl = (id) => {
      const attrs = new Map();
      const node = {
        id,
        style: {},
        dataset: {},
        hidden: false,
        disabled: false,
        value: "",
        textContent: "",
        className: "",
        checked: false,
        innerHTML: "",
        classList: {
          add() {},
          remove() {},
          toggle() {},
          contains() {
            return false;
          },
        },
        addEventListener(type, fn) {
          if (!listeners.has(id)) listeners.set(id, new Map());
          const map = listeners.get(id);
          if (!map.has(type)) map.set(type, []);
          map.get(type).push(fn);
        },
        removeEventListener() {},
        setAttribute(name, value) {
          attrs.set(name, value);
          if (name === "hidden") this.hidden = true;
          if (name === "aria-hidden") this.ariaHidden = value;
        },
        removeAttribute(name) {
          attrs.delete(name);
          if (name === "hidden") this.hidden = false;
          if (name === "aria-hidden") this.ariaHidden = null;
        },
        getAttribute(name) {
          return attrs.has(name) ? attrs.get(name) : null;
        },
        appendChild() {},
        querySelector() {
          return null;
        },
        querySelectorAll() {
          return [];
        },
        closest(sel) {
          // Mimic closest() so showFirstRunDonePanel can find the
          // .first-run-progress-wrap via firstRunStepLabel. Most tests
          // now use firstRunProgressWrap directly, but the wizard
          // module also relies on this if it ever falls back.
          if (sel === ".first-run-progress-wrap") {
            return els.get("firstRunProgressWrap") || null;
          }
          return null;
        },
        focus() {},
        __fire(type, ev) {
          const map = listeners.get(id);
          if (!map) return;
          (map.get(type) || []).forEach((fn) => fn(ev || {}));
        },
      };
      return node;
    };
    const document = {
      readyState: "complete",
      body: makeEl("body"),
      getElementById(id) {
        if (!els.has(id)) els.set(id, makeEl(id));
        return els.get(id);
      },
      querySelector() {
        return null;
      },
      querySelectorAll() {
        return [];
      },
      addEventListener(type, fn) {
        if (!docListeners.has(type)) docListeners.set(type, []);
        docListeners.get(type).push(fn);
      },
      createElement() {
        return makeEl("created");
      },
    };
    const window = {
      JobBoredApp: { core: { host: hostStub || {} } },
      COMMAND_CENTER_CONFIG: {},
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
    return { api: window.JobBoredApp.firstRunWizard, window, document, els };
  }

  const allCompleteHost = (over) => ({
    getSheetId: () => "sheet",
    isSignedIn: () => true,
    getOAuthClientId: () => "cid.apps.googleusercontent.com",
    getResumeGenerate: () => ({
      isResumeGenerationConfigured: () => true,
      getResumeGenerationConfig: () => ({
        provider: "openrouter",
        resumeOpenRouterApiKey: "sk-or-keep",
      }),
    }),
    ...over,
  });

  it("handleFirstRunFinish persists infraSetupComplete FIRST and shows the done panel (no dashboard handoff inline)", async () => {
    const order = [];
    const { api } = loadWizardWithRecordingDom(
      allCompleteHost({
        getUserContent: () => ({
          openDb: async () => {
            order.push("openDb");
          },
          completeInfraSetup: async () => {
            order.push("completeInfraSetup");
          },
        }),
        revealDashboardShell: () => order.push("revealDashboardShell"),
        renderPipeline: () => order.push("renderPipeline"),
        checkOnboardingGate: async () => order.push("checkOnboardingGate"),
      }),
    );
    api.reopenFirstRunWizard();
    await api.handleFirstRunFinish();

    // infraSetupComplete is the FIRST effect of finish (so the wizard
    // does not reappear on reload).
    assert.equal(order[0], "openDb");
    assert.equal(order[1], "completeInfraSetup");
    // The dashboard handoff chain must NOT fire inline anymore — the
    // done panel's "Go to dashboard" CTA owns it.
    assert.ok(
      !order.includes("revealDashboardShell"),
      "revealDashboardShell must NOT be called inline by handleFirstRunFinish — the done panel owns the handoff",
    );
    assert.ok(
      !order.includes("renderPipeline"),
      "renderPipeline must NOT be called inline by handleFirstRunFinish — the done panel owns the handoff",
    );
    assert.ok(
      !order.includes("checkOnboardingGate"),
      "checkOnboardingGate must NOT be called inline by handleFirstRunFinish — the done panel owns the handoff",
    );
    // The done panel is now showing.
    assert.equal(api.isFirstRunDonePanelVisible(), true);
    // The wizard is STILL visible (surface-ownership invariant): the
    // dashboard-reveal chokepoint keeps deferring while the done panel
    // is up.
    assert.equal(api.isFirstRunWizardActive(), true);
    assert.equal(api.isFirstRunWizardVisible(), true);
  });

  it("showFirstRunDonePanel hides the progress wrap + sheet/provider panels and shows the done panel", () => {
    const { api, document } = loadWizardWithRecordingDom(allCompleteHost());
    api.reopenFirstRunWizard();
    // Capture the progress wrap's pre-existing display value (could be
    // undefined / "" / etc. — the fake DOM's style object is empty until
    // the wizard writes to it). The assertion that matters is the
    // POST-condition: showFirstRunDonePanel must hide it.
    const progress = document.getElementById("firstRunProgressWrap");
    const preDisplay = progress.style.display;
    assert.notEqual(preDisplay, "none", "pre-condition: progress wrap starts visible");
    api.showFirstRunDonePanel();
    // Done panel up, step indicator + sheet/provider panels hidden.
    const done = document.getElementById("firstRunPanelDone");
    assert.equal(done.style.display, "block");
    assert.equal(done.getAttribute("aria-hidden"), "false");
    assert.equal(progress.style.display, "none");
    assert.equal(document.getElementById("firstRunPanelSheet").style.display, "none");
    assert.equal(document.getElementById("firstRunPanelProvider").style.display, "none");
  });

  it("hideFirstRunDonePanel restores the progress wrap and hides the done panel", () => {
    const { api, document } = loadWizardWithRecordingDom(allCompleteHost());
    api.reopenFirstRunWizard();
    api.showFirstRunDonePanel();
    assert.equal(api.isFirstRunDonePanelVisible(), true);
    api.hideFirstRunDonePanel();
    const done = document.getElementById("firstRunPanelDone");
    assert.equal(done.style.display, "none");
    assert.equal(done.getAttribute("aria-hidden"), "true");
    const progress = document
      .getElementById("firstRunStepLabel")
      .closest(".first-run-progress-wrap");
    assert.equal(progress.style.display, "");
  });

  it("the 700ms refresh loop short-circuits while the done panel is up (no panel visibility churn)", () => {
    // The refresh-loop guard is the regression risk that would re-show
    // #firstRunPanelProvider over #firstRunPanelDone (a VAL-WIZ-011/013
    // invariant). Assert refreshFirstRunWizard leaves panel display
    // alone when isFirstRunDonePanelVisible is true.
    const { api, document } = loadWizardWithRecordingDom(allCompleteHost());
    api.reopenFirstRunWizard();
    api.showFirstRunDonePanel();
    // The done panel is up; the sheet/provider panels are hidden.
    assert.equal(document.getElementById("firstRunPanelSheet").style.display, "none");
    assert.equal(document.getElementById("firstRunPanelProvider").style.display, "none");
    // refreshFirstRunWizard MUST NOT touch panel visibility while the
    // done panel is active.
    api.refreshFirstRunWizard();
    assert.equal(document.getElementById("firstRunPanelSheet").style.display, "none");
    assert.equal(document.getElementById("firstRunPanelProvider").style.display, "none");
    assert.equal(document.getElementById("firstRunPanelDone").style.display, "block");
  });

  it("handleFirstRunDoneToDashboard tears down the wizard THEN runs the dashboard handoff chain", () => {
    const order = [];
    const refreshCalls = [];
    const { api, window } = loadWizardWithRecordingDom(
      allCompleteHost({
        revealDashboardShell: () => order.push("revealDashboardShell"),
        renderPipeline: () => order.push("renderPipeline"),
        checkOnboardingGate: async () => order.push("checkOnboardingGate"),
      }),
    );
    // Stub the banner so we can observe the same-session refresh hook
    // (VAL-SIGN-001/002) — without it the banner only re-evaluates on
    // the next reload.
    window.JobBoredApp.whatsNextBanner = {
      refreshBanner: () => {
        refreshCalls.push("refresh");
        return Promise.resolve();
      },
    };
    api.reopenFirstRunWizard();
    api.showFirstRunDonePanel();
    api.handleFirstRunDoneToDashboard();
    // The wizard is now hidden, so isFirstRunWizardActive() returns
    // false (the dashboard-reveal chokepoint is released).
    assert.equal(api.isFirstRunWizardVisible(), false);
    assert.equal(api.isFirstRunWizardActive(), false);
    assert.deepEqual(order, [
      "revealDashboardShell",
      "renderPipeline",
      "checkOnboardingGate",
    ]);
    // The same-session banner refresh MUST have been invoked so the
    // banner re-evaluates its gate (infra + !dismissed + onboarding) for
    // the just-revealed dashboard render (VAL-SIGN-001/002).
    assert.equal(
      refreshCalls.length,
      1,
      "handleFirstRunDoneToDashboard must invoke whatsNextBanner.refreshBanner() so the dashboard banner re-evaluates its gate in the same session",
    );
  });

  it("handleFirstRunDoneToDashboard safely no-ops when the banner module is not on the window", () => {
    // The typeof-guard means a missing whats-next-banner module never
    // throws the dashboard handoff. Reflect the absent module on the
    // window before invoking.
    const { api, window } = loadWizardWithRecordingDom(allCompleteHost());
    delete window.JobBoredApp.whatsNextBanner;
    api.reopenFirstRunWizard();
    api.showFirstRunDonePanel();
    assert.doesNotThrow(() => api.handleFirstRunDoneToDashboard());
    assert.equal(api.isFirstRunWizardActive(), false);
  });

  it("handleFirstRunDoneOpenDiscovery hands off to the dashboard BEFORE opening discovery (so a short-circuiting/closed discovery wizard lands on the dashboard, not the login gate)", () => {
    const order = [];
    const calls = [];
    const { api } = loadWizardWithRecordingDom(
      allCompleteHost({
        revealDashboardShell: () => order.push("revealDashboardShell"),
        renderPipeline: () => order.push("renderPipeline"),
        checkOnboardingGate: async () => order.push("checkOnboardingGate"),
        requestDiscoverySetup: (opts) => {
          // Snapshot the wizard's surface-ownership state at the moment
          // requestDiscoverySetup is called: the first-run wizard MUST
          // already be torn down so the guided discovery wizard renders
          // on top, not behind the first-run overlay (VAL-SIGN-002).
          order.push({
            marker: "requestDiscoverySetup",
            entry: opts.entryPoint,
            allow: !!opts.allowWhileOnboarding,
            wizardVisible: api.isFirstRunWizardVisible(),
            wizardActive: api.isFirstRunWizardActive(),
          });
          calls.push(opts);
        },
      }),
    );
    api.reopenFirstRunWizard();
    api.showFirstRunDonePanel();
    assert.equal(
      api.isFirstRunWizardVisible(),
      true,
      "pre-condition: wizard is up before the CTA",
    );
    api.handleFirstRunDoneOpenDiscovery();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].entryPoint, "whats_next");
    assert.equal(
      calls[0].allowWhileOnboarding,
      true,
      "the in-wizard terminal discovery CTA must still pass allowWhileOnboarding:true (in case the profile/onboarding wizard becomes the active surface after release)",
    );

    // The dashboard handoff MUST run BEFORE requestDiscoverySetup. During
    // cold-start onboarding the surface underneath the first-run wizard is
    // the login gate (#sheetAccessGateScreen) — the done panel defers the
    // dashboard reveal to a CTA. Without revealing the dashboard first, a
    // discovery wizard that short-circuits (autodetect "already set up"),
    // errors, or is closed strands the user on the login screen instead of
    // their dashboard. Mirrors the "Go to dashboard" handoff.
    const revealIdx = order.indexOf("revealDashboardShell");
    const discoveryIdx = order.findIndex(
      (e) => e && typeof e === "object" && e.marker === "requestDiscoverySetup",
    );
    assert.ok(
      revealIdx !== -1,
      "revealDashboardShell must be called so the login gate is hidden under the discovery wizard",
    );
    assert.ok(discoveryIdx !== -1, "requestDiscoverySetup must be called");
    assert.ok(
      revealIdx < discoveryIdx,
      "revealDashboardShell must run BEFORE requestDiscoverySetup (reveal the dashboard, then open discovery on top)",
    );

    // The CTA must have released the wizard surface BEFORE the discovery
    // call — the discovery wizard must not render behind the first-run
    // overlay (VAL-SIGN-002).
    const discoveryCall = order[discoveryIdx];
    assert.equal(
      discoveryCall.wizardVisible,
      false,
      "the first-run wizard must be hidden BEFORE requestDiscoverySetup is invoked, so the discovery wizard renders on top",
    );
    assert.equal(
      discoveryCall.wizardActive,
      false,
      "isFirstRunWizardActive() must be false at the moment requestDiscoverySetup runs, so the dashboard-reveal chokepoint no longer defers",
    );
    assert.equal(
      discoveryCall.allow,
      true,
      "allowWhileOnboarding must still be true (in case the profile/onboarding wizard becomes the active surface after release)",
    );
    // Post-condition: the wizard stays torn down.
    assert.equal(api.isFirstRunWizardVisible(), false);
    assert.equal(api.isFirstRunWizardActive(), false);
  });

  it("handleFirstRunDoneOpenSelfHosting hands off to the dashboard BEFORE launching the go-live wizard (mirrors discovery CTA; replaces the old window.open(SELF-HOSTING.md) path)", () => {
    const order = [];
    const calls = [];
    const { api } = loadWizardWithRecordingDom(
      allCompleteHost({
        revealDashboardShell: () => order.push("revealDashboardShell"),
        renderPipeline: () => order.push("renderPipeline"),
        checkOnboardingGate: async () => order.push("checkOnboardingGate"),
        requestGoLiveSetup: (opts) => {
          // Snapshot surface-ownership state at the moment requestGoLiveSetup
          // is invoked: the first-run wizard MUST be torn down so the
          // go-live wizard renders on top of the dashboard (the same
          // VAL-SIGN-002 invariant the discovery CTA enforces).
          order.push({
            marker: "requestGoLiveSetup",
            entry: opts.entryPoint,
            allow: !!opts.allowWhileOnboarding,
            wizardVisible: api.isFirstRunWizardVisible(),
            wizardActive: api.isFirstRunWizardActive(),
          });
          calls.push(opts);
        },
      }),
    );
    api.reopenFirstRunWizard();
    api.showFirstRunDonePanel();
    assert.equal(
      api.isFirstRunWizardVisible(),
      true,
      "pre-condition: wizard is up before the CTA",
    );
    api.handleFirstRunDoneOpenSelfHosting();
    assert.equal(calls.length, 1, "requestGoLiveSetup must be called exactly once");
    assert.equal(calls[0].entryPoint, "whats_next");
    assert.equal(
      calls[0].allowWhileOnboarding,
      true,
      "the in-wizard terminal go-live CTA must pass allowWhileOnboarding:true so the wizard still opens when the profile/onboarding wizard becomes the active surface",
    );

    // Dashboard handoff MUST run BEFORE requestGoLiveSetup.
    const revealIdx = order.indexOf("revealDashboardShell");
    const goLiveIdx = order.findIndex(
      (e) => e && typeof e === "object" && e.marker === "requestGoLiveSetup",
    );
    assert.ok(
      revealIdx !== -1,
      "revealDashboardShell must be called so the login gate is hidden under the go-live wizard",
    );
    assert.ok(goLiveIdx !== -1, "requestGoLiveSetup must be called");
    assert.ok(
      revealIdx < goLiveIdx,
      "revealDashboardShell must run BEFORE requestGoLiveSetup (reveal the dashboard, then open go-live on top)",
    );

    // Surface released before the call.
    const goLiveCall = order[goLiveIdx];
    assert.equal(
      goLiveCall.wizardVisible,
      false,
      "the first-run wizard must be hidden BEFORE requestGoLiveSetup is invoked",
    );
    assert.equal(
      goLiveCall.wizardActive,
      false,
      "isFirstRunWizardActive() must be false at the moment requestGoLiveSetup runs (chokepoint released)",
    );
    assert.equal(
      goLiveCall.allow,
      true,
      "allowWhileOnboarding must still be true at the call site",
    );
  });

  it("handleFirstRunDoneOpenSelfHosting falls back to window.requestGoLiveSetup when the host bridge has no method (parity with the discovery CTA)", () => {
    const calls = [];
    const { api, window } = loadWizardWithRecordingDom(
      allCompleteHost({
        // host has no requestGoLiveSetup — fall through to window.
        revealDashboardShell: () => {},
        renderPipeline: () => {},
        checkOnboardingGate: async () => {},
      }),
    );
    window.requestGoLiveSetup = (opts) => calls.push(opts);
    api.reopenFirstRunWizard();
    api.showFirstRunDonePanel();
    api.handleFirstRunDoneOpenSelfHosting();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].entryPoint, "whats_next");
    assert.equal(calls[0].allowWhileOnboarding, true);
  });

  it("handleFirstRunDoneOpenSelfHosting no longer calls window.open(SELF-HOSTING.md) — the markdown deep-reference is now linked from inside the wizard, not the primary surface", () => {
    const opened = [];
    const { api, window } = loadWizardWithRecordingDom(
      allCompleteHost({
        revealDashboardShell: () => {},
        renderPipeline: () => {},
        checkOnboardingGate: async () => {},
        requestGoLiveSetup: () => {},
      }),
    );
    window.open = (url, target, features) => {
      opened.push({ url, target, features });
      return null;
    };
    api.reopenFirstRunWizard();
    api.showFirstRunDonePanel();
    api.handleFirstRunDoneOpenSelfHosting();
    assert.equal(
      opened.length,
      0,
      "the self-hosting CTA must NOT open the SELF-HOSTING.md markdown anymore — it launches the go-live wizard",
    );
  });

  it("the wizard module exposes the new done-panel API surface", () => {
    const { api } = loadWizardWithRecordingDom(allCompleteHost());
    for (const fn of [
      "isFirstRunDonePanelVisible",
      "showFirstRunDonePanel",
      "hideFirstRunDonePanel",
      "handleFirstRunFinish",
      "handleFirstRunDoneToDashboard",
      "handleFirstRunDoneOpenDiscovery",
      "handleFirstRunDoneOpenSelfHosting",
    ]) {
      assert.equal(
        typeof api[fn],
        "function",
        `firstRunWizard.${fn} should be a function`,
      );
    }
  });

  it("finish button listeners are wired inside the listenersWired one-shot guard", () => {
    // The new done-panel buttons must share the existing guard, not be
    // wired lazily (the feature description calls this out explicitly).
    const guardIdx = firstRunWizardJs.indexOf("if (listenersWired");
    const doneInit = firstRunWizardJs.indexOf("getEl(\"firstRunDoneToDashboard\")");
    assert.ok(guardIdx !== -1, "listenersWired guard must exist");
    assert.ok(doneInit !== -1, "done-button init must exist");
    assert.ok(
      doneInit > guardIdx,
      "done-button init must come AFTER the listenersWired guard (i.e. inside it)",
    );
  });

  // Mandatory two-track onboarding: completing first-run no longer just
  // drops the user on the dashboard — the done-panel primary completion
  // auto-launches discovery setup (which auto-chains to go-live), so the
  // user does NOT have to click the separate "Turn on job discovery" CTA.
  it("the done-panel primary 'Go to dashboard' button auto-launches discovery setup with the onboarding entry point", () => {
    const calls = [];
    const { api, document } = loadWizardWithRecordingDom(
      allCompleteHost({
        revealDashboardShell: () => {},
        renderPipeline: () => {},
        checkOnboardingGate: async () => {},
        requestDiscoverySetup: (opts) => calls.push(opts),
      }),
    );
    api.reopenFirstRunWizard();
    api.showFirstRunDonePanel();
    // Fire the PRIMARY completion button — not the secondary discovery CTA.
    document.getElementById("firstRunDoneToDashboard").__fire("click");
    assert.equal(
      calls.length,
      1,
      "completing first-run must auto-launch discovery exactly once (no separate click)",
    );
    assert.equal(
      calls[0].entryPoint,
      "onboarding",
      "the onboarding auto-launch must use the onboarding entry point (not whats_next)",
    );
    assert.equal(
      calls[0].allowWhileOnboarding,
      true,
      "auto-launch must allow while onboarding (the profile wizard may become the active surface)",
    );
  });

  // The explicit "Turn on job discovery" CTA keeps its original entry point
  // so the auto-launch rewire doesn't change the manual path's analytics.
  it("the secondary discovery CTA still uses the whats_next entry point (default preserved)", () => {
    const calls = [];
    const { api } = loadWizardWithRecordingDom(
      allCompleteHost({
        revealDashboardShell: () => {},
        renderPipeline: () => {},
        checkOnboardingGate: async () => {},
        requestDiscoverySetup: (opts) => calls.push(opts),
      }),
    );
    api.reopenFirstRunWizard();
    api.showFirstRunDonePanel();
    api.handleFirstRunDoneOpenDiscovery();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].entryPoint, "whats_next");
  });
});

// ============================================================
// VAL-SIGN-002: dismissible dashboard banner
// ============================================================

describe("index.html — whats-next dashboard region", () => {
  it("mounts a top-level <section data-region=\"whats-next\" hidden> adjacent to the materials-queue region", () => {
    assert.ok(
      indexHtml.includes('data-region="whats-next"'),
      "index.html must define a whats-next region",
    );
    const regionIdx = indexHtml.indexOf('data-region="whats-next"');
    // Find the full <section ...> opening tag (spans multiple lines so we
    // walk forward to the closing >).
    const sectionStart = indexHtml.lastIndexOf("<section", regionIdx);
    const sectionEnd = indexHtml.indexOf(">", regionIdx);
    assert.ok(sectionStart !== -1 && sectionEnd !== -1, "section must exist");
    const openingTag = indexHtml.slice(sectionStart, sectionEnd + 1);
    assert.match(
      openingTag,
      /\bhidden\b/,
      "the section's opening tag must include the hidden attribute (hidden-when-empty pattern)",
    );
    assert.match(
      openingTag,
      /data-region="whats-next"/,
      "the section's opening tag must carry data-region=whats-next",
    );
    // Adjacent to materials-queue: the whats-next region starts AFTER the
    // materials-queue region ends and BEFORE the next region (pipeline)
    // starts, mirroring the materials-queue region's own placement.
    const mqStart = indexHtml.indexOf("region:materials-queue:start");
    const mqEnd = indexHtml.indexOf("region:materials-queue:end");
    const pipelineStart = indexHtml.indexOf("region:pipeline:start");
    const wnStart = indexHtml.indexOf("region:whats-next:start");
    const wnEnd = indexHtml.indexOf("region:whats-next:end");
    assert.ok(mqStart !== -1 && mqEnd !== -1, "materials-queue region markers must exist");
    assert.ok(wnStart !== -1 && wnEnd !== -1, "whats-next region markers must exist");
    assert.ok(pipelineStart !== -1, "pipeline region must exist after the new banner");
    assert.ok(
      wnStart > mqEnd && wnEnd < pipelineStart,
      "the whats-next region must sit between the materials-queue end and the pipeline start",
    );
  });

  it("the banner carries the same two OPTIONAL CTAs as the terminal wizard panel + a Dismiss control", () => {
    assert.match(indexHtml, /id="whatsNextOpenDiscovery"/);
    assert.match(indexHtml, /id="whatsNextOpenSelfHosting"/);
    assert.match(indexHtml, /id="whatsNextDismiss"/);
  });

  it("loads whats-next-banner.js after first-run-wizard.js", () => {
    const a = indexHtml.indexOf("whats-next-banner.js");
    const b = indexHtml.indexOf("first-run-wizard.js");
    assert.ok(a !== -1, "whats-next-banner.js must be loaded by index.html");
    assert.ok(b !== -1);
    assert.ok(
      a > b,
      "whats-next-banner.js must load AFTER first-run-wizard.js (the banner reads the same UC store + refreshes after the wizard finishes)",
    );
  });

  it("whats-next-banner.js is on the typecheck:repo chain", () => {
    const chain = String(packageJson.scripts && packageJson.scripts["typecheck:repo"]);
    assert.match(
      chain,
      /node --check whats-next-banner\.js/,
      "typecheck:repo must syntax-check whats-next-banner.js",
    );
  });
});

describe("whats-next-banner module — gating + dismiss persistence", () => {
  function loadBanner({ querySelectorImpl = null } = {}) {
    const listeners = new Map();
    const els = new Map();
    const makeEl = (id) => {
      const node = {
        id,
        style: {},
        dataset: {},
        hidden: false,
        disabled: false,
        value: "",
        textContent: "",
        className: "",
        checked: false,
        innerHTML: "",
        classList: {
          add() {},
          remove() {},
          toggle() {},
          contains() {
            return false;
          },
        },
        addEventListener(type, fn) {
          if (!listeners.has(id)) listeners.set(id, new Map());
          const map = listeners.get(id);
          if (!map.has(type)) map.set(type, []);
          map.get(type).push(fn);
        },
        removeEventListener() {},
        setAttribute() {},
        removeAttribute() {},
        getAttribute() {
          return null;
        },
        appendChild() {},
        querySelector() {
          return null;
        },
        querySelectorAll() {
          return [];
        },
        closest() {
          return null;
        },
        focus() {},
        __fire(type, ev) {
          const map = listeners.get(id);
          if (!map) return;
          (map.get(type) || []).forEach((fn) => fn(ev || {}));
        },
      };
      return node;
    };
    const region = makeEl("whats-next-region");
    region.hasAttribute = function (name) {
      return Object.prototype.hasOwnProperty.call(this.dataset || {}, "hidden") ||
        (name === "hidden" && !!this.dataset.hidden);
    };
    region.setAttribute = function (name, value) {
      if (name === "hidden") this.dataset.hidden = value;
    };
    region.removeAttribute = function (name) {
      if (name === "hidden") delete this.dataset.hidden;
    };
    const document = {
      readyState: "complete",
      body: makeEl("body"),
      getElementById(id) {
        if (!els.has(id)) els.set(id, makeEl(id));
        return els.get(id);
      },
      querySelector(sel) {
        if (sel === '[data-region="whats-next"]') {
          return querySelectorImpl ? querySelectorImpl(region) : region;
        }
        return null;
      },
      querySelectorAll() {
        return [];
      },
      addEventListener() {},
      createElement() {
        return makeEl("created");
      },
    };
    const window = {
      JobBoredApp: {},
      COMMAND_CENTER_CONFIG: {},
    };
    const ctx = {
      window,
      document,
      console,
      setTimeout,
      requestAnimationFrame: (fn) => fn(),
    };
    vm.createContext(ctx);
    vm.runInContext(whatsNextBannerJs, ctx, {
      filename: "whats-next-banner.js",
    });
    return { api: window.JobBoredApp.whatsNextBanner, window, document, region, els };
  }

  const gateStates = {
    allTrue: {
      openDb: async () => {},
      isInfraSetupComplete: async () => true,
      getWhatsNextDismissed: async () => false,
      isOnboardingComplete: async () => true,
    },
    infraFalse: {
      openDb: async () => {},
      isInfraSetupComplete: async () => false,
      getWhatsNextDismissed: async () => false,
      isOnboardingComplete: async () => true,
    },
    dismissedTrue: {
      openDb: async () => {},
      isInfraSetupComplete: async () => true,
      getWhatsNextDismissed: async () => true,
      isOnboardingComplete: async () => true,
    },
    onboardingFalse: {
      openDb: async () => {},
      isInfraSetupComplete: async () => true,
      getWhatsNextDismissed: async () => false,
      isOnboardingComplete: async () => false,
    },
  };

  function hostWithUC(UC) {
    return { getUserContent: () => UC };
  }

  it("shows the banner ONLY when (infraComplete && !dismissed && onboardingComplete)", async () => {
    for (const [label, UC, expected] of [
      ["all true → show", gateStates.allTrue, true],
      ["infra incomplete → hide", gateStates.infraFalse, false],
      ["dismissed → hide", gateStates.dismissedTrue, false],
      ["onboarding incomplete → hide", gateStates.onboardingFalse, false],
    ]) {
      const { api, region, window } = loadBanner();
      window.JobBoredApp.core = { host: hostWithUC(UC) };
      const state = await api.refreshBanner();
      assert.equal(
        state.infraComplete,
        expected ? true : UC.isInfraSetupComplete.toString().includes("true"),
        `${label}: state.infraComplete should reflect UC`,
      );
      assert.equal(
        !!region.dataset.hidden,
        !expected,
        `${label}: region.hidden should be ${!expected}`,
      );
      assert.equal(api.isBannerVisible(), expected, `${label}: isBannerVisible`);
    }
  });

  it("dismiss writes whatsNextDismissed=true and hides the banner; a re-render keeps it hidden", async () => {
    let dismissed = false;
    const writes = [];
    const UC = {
      openDb: async () => {},
      isInfraSetupComplete: async () => true,
      getWhatsNextDismissed: async () => dismissed,
      setWhatsNextDismissed: async (v) => {
        writes.push(v);
        dismissed = !!v;
      },
      isOnboardingComplete: async () => true,
    };
    const { api, region, window } = loadBanner();
    window.JobBoredApp.core = { host: hostWithUC(UC) };
    // Initial: should show.
    await api.refreshBanner();
    assert.equal(api.isBannerVisible(), true);
    // Dismiss.
    await api.handleDismiss();
    assert.deepEqual(writes, [true]);
    assert.equal(api.isBannerVisible(), false);
    assert.equal(!!region.dataset.hidden, true);
    // Re-render: state.infraComplete=true && state.dismissed=true → still hidden.
    await api.refreshBanner();
    assert.equal(api.isBannerVisible(), false);
  });

  it("hideBanner / showBanner toggle the region without consulting the gate (test seam)", () => {
    const { api, region } = loadBanner();
    api.showBanner();
    assert.equal(!!region.dataset.hidden, false);
    assert.equal(api.isBannerVisible(), true);
    api.hideBanner();
    assert.equal(!!region.dataset.hidden, true);
    assert.equal(api.isBannerVisible(), false);
  });

  it("handleOpenDiscovery calls host.requestDiscoverySetup with entryPoint=whats_next", () => {
    const calls = [];
    const { api, window } = loadBanner();
    window.JobBoredApp.core = {
      host: {
        getUserContent: () => gateStates.allTrue,
        requestDiscoverySetup: (opts) => calls.push(opts),
      },
    };
    api.handleOpenDiscovery();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].entryPoint, "whats_next");
  });

  it("handleOpenSelfHosting calls host.requestGoLiveSetup with entryPoint=whats_next (no window.open SELF-HOSTING.md)", () => {
    const calls = [];
    const opened = [];
    const { api, window } = loadBanner();
    window.open = (url, target, features) => {
      opened.push({ url, target, features });
      return null;
    };
    window.JobBoredApp.core = {
      host: {
        getUserContent: () => gateStates.allTrue,
        requestGoLiveSetup: (opts) => calls.push(opts),
      },
    };
    api.handleOpenSelfHosting();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].entryPoint, "whats_next");
    assert.equal(
      opened.length,
      0,
      "the banner's self-hosting CTA must NOT open the SELF-HOSTING.md markdown anymore — it launches the go-live wizard",
    );
  });

  it("handleOpenSelfHosting falls back to window.requestGoLiveSetup when the host bridge has no method", () => {
    const calls = [];
    const { api, window } = loadBanner();
    window.JobBoredApp.core = { host: { getUserContent: () => gateStates.allTrue } };
    window.requestGoLiveSetup = (opts) => calls.push(opts);
    api.handleOpenSelfHosting();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].entryPoint, "whats_next");
  });
});

// ============================================================
// FE-3: completion-aware banner. Both flags drive per-track CTA
// visibility + the "recommended next" marker. When BOTH flags
// are true the whole region hides so the dashboard stays clean.
// ============================================================

describe("whats-next-banner module — completion-awareness (FE-3)", () => {
  /**
   * Richer banner loader that tracks attribute changes per element so
   * we can assert which CTAs were hidden / marked recommended. Mirrors
   * loadBanner above; kept inline to avoid coupling completion-awareness
   * tests to the simpler scaffold the gating tests use.
   */
  function loadCompletionBanner() {
    const els = new Map();
    const makeEl = (id) => {
      const attrs = new Map();
      const classes = new Set();
      const node = {
        id,
        style: {},
        dataset: {},
        textContent: "",
        innerHTML: "",
        get hidden() {
          return attrs.has("hidden");
        },
        classList: {
          add(c) {
            classes.add(c);
          },
          remove(c) {
            classes.delete(c);
          },
          contains(c) {
            return classes.has(c);
          },
          toggle(c) {
            if (classes.has(c)) classes.delete(c);
            else classes.add(c);
          },
        },
        addEventListener() {},
        removeEventListener() {},
        setAttribute(name, value) {
          attrs.set(name, value);
        },
        removeAttribute(name) {
          attrs.delete(name);
        },
        getAttribute(name) {
          return attrs.has(name) ? attrs.get(name) : null;
        },
        hasAttribute(name) {
          return attrs.has(name);
        },
        appendChild() {},
        querySelector() {
          return null;
        },
        querySelectorAll() {
          return [];
        },
        closest() {
          return null;
        },
        focus() {},
        __classes: classes,
        __attrs: attrs,
      };
      return node;
    };
    const region = makeEl("whats-next-region");
    const document = {
      readyState: "complete",
      body: makeEl("body"),
      getElementById(id) {
        if (!els.has(id)) els.set(id, makeEl(id));
        return els.get(id);
      },
      querySelector(sel) {
        if (sel === '[data-region="whats-next"]') return region;
        return null;
      },
      querySelectorAll() {
        return [];
      },
      addEventListener() {},
      createElement() {
        return makeEl("created");
      },
    };
    const window = { JobBoredApp: {}, COMMAND_CENTER_CONFIG: {} };
    const ctx = {
      window,
      document,
      console,
      setTimeout,
      requestAnimationFrame: (fn) => fn(),
    };
    vm.createContext(ctx);
    vm.runInContext(whatsNextBannerJs, ctx, { filename: "whats-next-banner.js" });
    return {
      api: window.JobBoredApp.whatsNextBanner,
      window,
      document,
      region,
      getButton: (id) => document.getElementById(id),
    };
  }

  function ucWith({ discoveryComplete = false, goLiveComplete = false } = {}) {
    return {
      openDb: async () => {},
      isInfraSetupComplete: async () => true,
      getWhatsNextDismissed: async () => false,
      isOnboardingComplete: async () => true,
      isDiscoverySetupComplete: async () => discoveryComplete,
      isGoLiveSetupComplete: async () => goLiveComplete,
    };
  }

  it("readGateState exposes discoveryComplete + goLiveComplete from UC", async () => {
    const { api, window } = loadCompletionBanner();
    window.JobBoredApp.core = {
      host: { getUserContent: () => ucWith({ discoveryComplete: true, goLiveComplete: false }) },
    };
    const state = await api.refreshBanner();
    assert.equal(state.discoveryComplete, true);
    assert.equal(state.goLiveComplete, false);
  });

  it("hides the discovery CTA + promotes self-hosting as recommended when only discovery is done", async () => {
    const { api, window, getButton, region } = loadCompletionBanner();
    window.JobBoredApp.core = {
      host: { getUserContent: () => ucWith({ discoveryComplete: true, goLiveComplete: false }) },
    };
    await api.refreshBanner();
    assert.equal(api.isBannerVisible(), true, "one track still pending → banner stays visible");
    assert.equal(
      getButton("whatsNextOpenDiscovery").hasAttribute("hidden"),
      true,
      "discovery CTA must hide once discoverySetupComplete is true",
    );
    assert.equal(
      getButton("whatsNextOpenSelfHosting").hasAttribute("hidden"),
      false,
      "self-hosting CTA stays visible as the recommended next step",
    );
    assert.equal(
      getButton("whatsNextOpenSelfHosting").classList.contains(
        "whats-next-banner__cta--recommended",
      ),
      true,
      "the remaining CTA must be marked as the recommended next step",
    );
    assert.equal(
      getButton("whatsNextOpenDiscovery").classList.contains(
        "whats-next-banner__cta--recommended",
      ),
      false,
      "the completed CTA must not carry the recommended marker",
    );
    // Region itself stays visible.
    assert.equal(region.hasAttribute("hidden"), false);
  });

  it("hides the self-hosting CTA + promotes discovery as recommended when only go-live is done", async () => {
    const { api, window, getButton } = loadCompletionBanner();
    window.JobBoredApp.core = {
      host: { getUserContent: () => ucWith({ discoveryComplete: false, goLiveComplete: true }) },
    };
    await api.refreshBanner();
    assert.equal(api.isBannerVisible(), true);
    assert.equal(getButton("whatsNextOpenSelfHosting").hasAttribute("hidden"), true);
    assert.equal(getButton("whatsNextOpenDiscovery").hasAttribute("hidden"), false);
    assert.equal(
      getButton("whatsNextOpenDiscovery").classList.contains(
        "whats-next-banner__cta--recommended",
      ),
      true,
    );
  });

  it("hides the whole banner when BOTH discovery and go-live are complete (either order)", async () => {
    const { api, window, region } = loadCompletionBanner();
    window.JobBoredApp.core = {
      host: { getUserContent: () => ucWith({ discoveryComplete: true, goLiveComplete: true }) },
    };
    await api.refreshBanner();
    assert.equal(
      api.isBannerVisible(),
      false,
      "both tracks complete → no more next-steps to recommend",
    );
    assert.equal(region.hasAttribute("hidden"), true);
  });

  it("when neither is complete, both CTAs stay visible and neither is the singular recommendation", async () => {
    const { api, window, getButton } = loadCompletionBanner();
    window.JobBoredApp.core = {
      host: { getUserContent: () => ucWith({ discoveryComplete: false, goLiveComplete: false }) },
    };
    await api.refreshBanner();
    assert.equal(api.isBannerVisible(), true);
    assert.equal(getButton("whatsNextOpenDiscovery").hasAttribute("hidden"), false);
    assert.equal(getButton("whatsNextOpenSelfHosting").hasAttribute("hidden"), false);
    // Neither carries the recommended marker — the user gets to choose.
    assert.equal(
      getButton("whatsNextOpenDiscovery").classList.contains(
        "whats-next-banner__cta--recommended",
      ),
      false,
    );
    assert.equal(
      getButton("whatsNextOpenSelfHosting").classList.contains(
        "whats-next-banner__cta--recommended",
      ),
      false,
    );
  });
});

// ============================================================
// Mandatory two-track onboarding: the banner is upgraded into a
// setup-progress bar ("Finish setup — N of 2 complete") that is
// non-dismissible while either track is pending EXCEPT a small
// session-scoped "Later" snooze (sessionStorage, not the permanent
// whatsNextDismissed flag). Mirrors loadCompletionBanner above but
// adds a sessionStorage stub so the snooze path is exercisable.
// ============================================================

describe("whats-next-banner module — setup progress + session Later", () => {
  function loadProgressBanner() {
    const els = new Map();
    const makeEl = (id) => {
      const attrs = new Map();
      const classes = new Set();
      const node = {
        id,
        style: {},
        dataset: {},
        textContent: "",
        innerHTML: "",
        get hidden() {
          return attrs.has("hidden");
        },
        classList: {
          add(c) {
            classes.add(c);
          },
          remove(c) {
            classes.delete(c);
          },
          contains(c) {
            return classes.has(c);
          },
          toggle(c) {
            if (classes.has(c)) classes.delete(c);
            else classes.add(c);
          },
        },
        addEventListener() {},
        removeEventListener() {},
        setAttribute(name, value) {
          attrs.set(name, value);
        },
        removeAttribute(name) {
          attrs.delete(name);
        },
        getAttribute(name) {
          return attrs.has(name) ? attrs.get(name) : null;
        },
        hasAttribute(name) {
          return attrs.has(name);
        },
        appendChild() {},
        querySelector() {
          return null;
        },
        querySelectorAll() {
          return [];
        },
        closest() {
          return null;
        },
        focus() {},
        __classes: classes,
        __attrs: attrs,
      };
      return node;
    };
    const region = makeEl("whats-next-region");
    const document = {
      readyState: "complete",
      body: makeEl("body"),
      getElementById(id) {
        if (!els.has(id)) els.set(id, makeEl(id));
        return els.get(id);
      },
      querySelector(sel) {
        if (sel === '[data-region="whats-next"]') return region;
        return null;
      },
      querySelectorAll() {
        return [];
      },
      addEventListener() {},
      createElement() {
        return makeEl("created");
      },
    };
    // Map-backed sessionStorage stub: the session "Later" snooze writes
    // here, NOT to the IndexedDB-backed whatsNextDismissed flag.
    const sessionMap = new Map();
    const sessionStorage = {
      getItem(key) {
        return sessionMap.has(key) ? sessionMap.get(key) : null;
      },
      setItem(key, value) {
        sessionMap.set(key, String(value));
      },
      removeItem(key) {
        sessionMap.delete(key);
      },
    };
    const window = {
      JobBoredApp: {},
      COMMAND_CENTER_CONFIG: {},
      sessionStorage,
    };
    const ctx = {
      window,
      document,
      console,
      setTimeout,
      requestAnimationFrame: (fn) => fn(),
    };
    vm.createContext(ctx);
    vm.runInContext(whatsNextBannerJs, ctx, { filename: "whats-next-banner.js" });
    return {
      api: window.JobBoredApp.whatsNextBanner,
      window,
      document,
      region,
      sessionMap,
      getButton: (id) => document.getElementById(id),
    };
  }

  function ucWith({
    discoveryComplete = false,
    goLiveComplete = false,
    dismissedWrites,
  } = {}) {
    return {
      openDb: async () => {},
      isInfraSetupComplete: async () => true,
      getWhatsNextDismissed: async () => false,
      isOnboardingComplete: async () => true,
      isDiscoverySetupComplete: async () => discoveryComplete,
      isGoLiveSetupComplete: async () => goLiveComplete,
      setWhatsNextDismissed: async (v) => {
        if (dismissedWrites) dismissedWrites.push(v);
      },
    };
  }

  it("shows 'Finish setup — 1 of 2 complete' when only discovery is done", async () => {
    const { api, window, getButton } = loadProgressBanner();
    window.JobBoredApp.core = {
      host: {
        getUserContent: () =>
          ucWith({ discoveryComplete: true, goLiveComplete: false }),
      },
    };
    // Pre-seed the hidden attribute so the assertion proves the bar was
    // actively revealed (not merely never hidden).
    getButton("whatsNextSetupProgress").setAttribute("hidden", "hidden");
    await api.refreshBanner();
    const progress = getButton("whatsNextSetupProgress");
    assert.match(progress.textContent, /1 of 2/);
    assert.equal(progress.hasAttribute("hidden"), false);
  });

  it("reveals the session 'Later' button while setup is incomplete", async () => {
    const { api, window, getButton } = loadProgressBanner();
    window.JobBoredApp.core = {
      host: {
        getUserContent: () =>
          ucWith({ discoveryComplete: false, goLiveComplete: false }),
      },
    };
    getButton("whatsNextLater").setAttribute("hidden", "hidden");
    await api.refreshBanner();
    assert.equal(getButton("whatsNextLater").hasAttribute("hidden"), false);
  });

  it("handleLater hides the bar via sessionStorage and a re-render keeps it hidden", async () => {
    const { api, window } = loadProgressBanner();
    window.JobBoredApp.core = {
      host: {
        getUserContent: () =>
          ucWith({ discoveryComplete: false, goLiveComplete: false }),
      },
    };
    await api.refreshBanner();
    assert.equal(api.isBannerVisible(), true);
    api.handleLater();
    assert.equal(api.isBannerVisible(), false);
    // Re-render in the same "session": the snooze keeps it hidden even
    // though both tracks are still pending.
    await api.refreshBanner();
    assert.equal(api.isBannerVisible(), false);
  });

  it("Later snooze does NOT write the permanent whatsNextDismissed flag", async () => {
    const dismissedWrites = [];
    const { api, window } = loadProgressBanner();
    window.JobBoredApp.core = {
      host: {
        getUserContent: () =>
          ucWith({
            discoveryComplete: false,
            goLiveComplete: false,
            dismissedWrites,
          }),
      },
    };
    await api.refreshBanner();
    api.handleLater();
    assert.equal(
      dismissedWrites.length,
      0,
      "Later must not call setWhatsNextDismissed (that is the permanent dismiss)",
    );
  });
});
