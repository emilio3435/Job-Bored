import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

// Faithful integrated reproduction of VAL-WIZ-012's LIVE failure: a signed-in
// user with a Sheet already connected clicks "Create a new Sheet" inside the
// first-run wizard; the live token lacks the Sheets scope so the create hits a
// 403 "insufficient authentication scopes" mid-flight, which triggers a consent
// re-auth (signIn{prompt:"consent"}); on consent success the auth layer resumes
// the create. The wizard must stay put (display:flex), the dashboard must stay
// hidden, and the create must NOT take the full dashboard-handoff path.
//
// Unlike tests/first-run-wizard-create-stays-in-flow.test.mjs (which stubs the
// create primitive), this test loads the REAL first-run-wizard.js AND the REAL
// sheet-access-setup.js into one shared DOM, drives the REAL createBlankStarterSheet
// 403 branch via a stubbed fetch, and mirrors auth-session.js sign-in-success
// with a realistic auth shim. It also drives a stray dashboard-reveal entry
// point (the slow page-load loadAllData().then(revealDashboardShell) race) while
// the wizard owns the surface, and asserts the dashboard is NOT revealed.

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const firstRunWizardJs = readFileSync(
  join(repoRoot, "first-run-wizard.js"),
  "utf8",
);
const sheetAccessSetupJs = readFileSync(
  join(repoRoot, "sheet-access-setup.js"),
  "utf8",
);

const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";

// --- Recording DOM (fires listeners, persists element state) -------------

function makeRecordingEl(id) {
  const listeners = {};
  return {
    id,
    style: {},
    dataset: {},
    hidden: false,
    disabled: false,
    value: "",
    textContent: "",
    className: "",
    href: "",
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
      (listeners[type] = listeners[type] || []).push(fn);
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
      (listeners[type] || []).forEach((fn) => fn(ev || {}));
    },
  };
}

function makeRecordingDoc() {
  const els = new Map();
  const docListeners = {};
  const documentElement = makeRecordingEl("html");
  return {
    readyState: "complete",
    documentElement,
    body: makeRecordingEl("body"),
    getElementById(id) {
      if (!els.has(id)) els.set(id, makeRecordingEl(id));
      return els.get(id);
    },
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
    addEventListener(type, fn) {
      (docListeners[type] = docListeners[type] || []).push(fn);
    },
    createElement() {
      return makeRecordingEl("created");
    },
    __fireDoc(type, ev) {
      (docListeners[type] || []).forEach((fn) => fn(ev || {}));
    },
  };
}

const flush = async (n = 25) => {
  for (let i = 0; i < n; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};

// Build a shared realm with both real modules + a realistic auth shim.
function loadIntegratedHarness({ initialSheetId = "preexisting-sheet-id" } = {}) {
  const calls = {
    signIn: [],
    loadAll: 0,
    bootstrap: 0,
    discovery: 0,
    open: 0,
    reveal: 0,
    merge: [],
    createPost: 0,
  };
  const authState = {
    accessToken: "tok-initial",
    // Optimistic: the restored session CLAIMS the Sheets scope even though the
    // live token will be rejected server-side with a 403 mid-create.
    grantedScopes: `${SHEETS_SCOPE} email profile`,
    signedIn: true,
  };
  const coreState = { sheetId: initialSheetId, pendingCreate: false };

  const document = makeRecordingDoc();
  const window = {
    COMMAND_CENTER_CONFIG: { resumeProvider: "openrouter" },
    location: { search: "" },
    open: () => {
      calls.open += 1;
    },
  };

  function sheetId() {
    return coreState.sheetId;
  }

  function normScopes(raw) {
    return [...new Set(String(raw || "").trim().split(/\s+/).filter(Boolean))];
  }

  const host = {
    // --- identity / auth (mirrors auth-session.js) ---
    getOAuthClientId: () => "cid.apps.googleusercontent.com",
    getAccessToken: () => authState.accessToken,
    isSignedIn: () => authState.signedIn,
    hasGrantedOauthScope: (scope) =>
      normScopes(authState.grantedScopes).includes(String(scope || "").trim()),
    getGoogleSheetsScope: () => SHEETS_SCOPE,
    refreshAccessTokenSilently: async () => false,
    clearSessionAuthState: () => {},
    // Realistic sign-in: simulate a GIS consent grant, then mirror the
    // auth-session.js handleTokenResponse interactive branch.
    signIn: (opts) => {
      calls.signIn.push(opts || {});
      Promise.resolve().then(() => {
        authState.accessToken = "tok-after-consent";
        authState.grantedScopes = `${SHEETS_SCOPE} email profile`;
        if (coreState.pendingCreate) {
          coreState.pendingCreate = false;
          if (!sheetId()) host.revealSetupScreenAfterAuth();
          // Resume with NO args: recovers the wizard create context.
          void host.handleSetupCreateStarterSheet();
          return;
        }
        // The path the live bug took "instead of" the resume branch: a
        // signed-in user with a sheet would reveal the dashboard.
        if (sheetId()) {
          host.showSheetAccessGate("loading");
          Promise.resolve(host.loadAllData()).then((ok) => {
            if (ok) host.revealDashboardShell();
          });
        }
      });
    },

    // --- sheet / config plumbing ---
    getSheetId: () => coreState.sheetId,
    getSHEET_ID: () => coreState.sheetId,
    parseGoogleSheetId: (raw) => String(raw || "").trim() || null,
    mergeStoredConfigOverridePatch: (patch) => {
      calls.merge.push(patch);
      if (patch && patch.sheetId) coreState.sheetId = patch.sheetId;
    },
    setInitialSheetAccessResolved: () => {},
    getStarterPipelineHeaders: () => ["Company", "Role", "Status"],
    getStarterPipelineHeaderRange: () => "Pipeline!A1:C1",
    showToast: () => {},
    openCommandCenterSettingsModal: () => {},

    // --- dashboard handoff surfaces (REAL ones delegate via setup module) ---
    revealDashboardShell: (...a) => {
      calls.reveal += 1;
      return window.JobBoredApp.setup.revealDashboardShell(...a);
    },
    revealSetupScreenAfterAuth: (...a) =>
      window.JobBoredApp.setup.revealSetupScreenAfterAuth(...a),
    showSheetAccessGate: (...a) =>
      window.JobBoredApp.setup.showSheetAccessGate(...a),
    setDashboardSheetLinks: (...a) =>
      window.JobBoredApp.setup.setDashboardSheetLinks(...a),
    handleSetupCreateStarterSheet: (...a) =>
      window.JobBoredApp.setup.handleSetupCreateStarterSheet(...a),
    runPostAccessBootstrapOnce: async () => {
      calls.bootstrap += 1;
    },
    loadAllData: () => {
      calls.loadAll += 1;
      return Promise.resolve(true);
    },
    requestDiscoverySetup: async () => {
      calls.discovery += 1;
    },
    hasPendingDiscoverySetup: () => false,

    // --- wizard surface signals (REAL ones delegate via wizard module) ---
    isFirstRunWizardVisible: (...a) =>
      window.JobBoredApp.firstRunWizard.isFirstRunWizardVisible(...a),
    isFirstRunWizardActive: (...a) =>
      window.JobBoredApp.firstRunWizard.isFirstRunWizardActive(...a),

    // --- provider step (kept unconfigured so advance lands on provider) ---
    getResumeGenerate: () => ({
      isResumeGenerationConfigured: () => false,
      getResumeGenerationConfig: () => ({ provider: "openrouter" }),
    }),
    renderPipeline: () => {},
    checkOnboardingGate: async () => {},
  };

  const core = {
    host,
    getGisLoaded: () => true,
    getTokenClient: () => ({}),
    setPendingSetupStarterSheetCreate: (v) => {
      coreState.pendingCreate = !!v;
    },
    getPendingSetupStarterSheetCreate: () => coreState.pendingCreate,
    setSHEET_ID: (id) => {
      coreState.sheetId = id;
    },
    getSHEET_ID: () => coreState.sheetId,
  };

  window.JobBoredApp = { core };

  let createPostCount = 0;
  const fetchStub = async (url, options) => {
    const method = (options && options.method) || "GET";
    if (method === "POST" && /\/spreadsheets$/.test(String(url))) {
      createPostCount += 1;
      calls.createPost = createPostCount;
      if (createPostCount === 1) {
        // First attempt with the optimistic-but-unscoped token: 403.
        return {
          status: 403,
          ok: false,
          json: async () => ({
            error: {
              message: "Request had insufficient authentication scopes.",
            },
          }),
        };
      }
      return {
        status: 200,
        ok: true,
        json: async () => ({
          spreadsheetId: "created-sheet-id",
          spreadsheetUrl:
            "https://docs.google.com/spreadsheets/d/created-sheet-id/edit",
        }),
      };
    }
    // Header PUT write.
    return { status: 200, ok: true, json: async () => ({}) };
  };

  const ctx = {
    window,
    document,
    console,
    fetch: fetchStub,
    URLSearchParams,
    Date,
    encodeURIComponent,
    setTimeout,
    clearInterval,
    setInterval: () => 0,
    requestAnimationFrame: (fn) => fn(),
  };
  vm.createContext(ctx);
  vm.runInContext(sheetAccessSetupJs, ctx, { filename: "sheet-access-setup.js" });
  vm.runInContext(firstRunWizardJs, ctx, { filename: "first-run-wizard.js" });

  return {
    wizard: window.JobBoredApp.firstRunWizard,
    setup: window.JobBoredApp.setup,
    document,
    window,
    calls,
    coreState,
  };
}

describe("first-run wizard — create + 403-consent resume stays in the wizard (VAL-WIZ-012)", () => {
  it("a wizard create that hits a 403 scope re-auth resumes in the wizard, advances, and never reveals the dashboard", async () => {
    const h = loadIntegratedHarness({ initialSheetId: "preexisting-sheet-id" });
    h.wizard.reopenFirstRunWizard();
    assert.equal(h.wizard.isFirstRunWizardVisible(), true);
    assert.equal(
      h.document.getElementById("firstRunPanelSheet").style.display,
      "block",
      "re-entry should land on the Sheet step",
    );

    h.document.getElementById("firstRunCreateSheetBtn").__fire("click", {});
    await flush();

    // The create hit a 403 and triggered exactly one consent re-auth.
    assert.equal(
      h.calls.signIn.length,
      1,
      "the 403 insufficient-scopes branch must trigger one consent re-auth",
    );
    assert.equal(
      h.calls.signIn[0].prompt,
      "consent",
      "the mid-create re-auth must force the consent prompt",
    );
    // The Sheet was created exactly once (first POST 403, second POST 200).
    assert.equal(
      h.calls.createPost,
      2,
      "create should POST twice: the 403 attempt then the successful retry",
    );
    assert.equal(
      h.calls.merge.filter((p) => p && p.sheetId).length,
      1,
      "the new sheet id is persisted exactly once (the successful create)",
    );
    assert.equal(h.coreState.sheetId, "created-sheet-id");

    // The wizard stayed put and advanced; the dashboard never showed.
    assert.equal(
      h.wizard.isFirstRunWizardVisible(),
      true,
      "the wizard must stay visible across the create + consent resume",
    );
    assert.equal(
      h.document.getElementById("firstRunPanelSheet").style.display,
      "none",
      "the Sheet step is no longer active after a successful create",
    );
    assert.equal(
      h.document.getElementById("firstRunPanelProvider").style.display,
      "block",
      "the wizard advances to the next incomplete step (provider)",
    );
    assert.notEqual(
      h.document.getElementById("dashboard").style.display,
      "block",
      "the wizard create must not reveal the dashboard",
    );
    assert.equal(
      h.calls.loadAll,
      0,
      "the wizard create path must NOT call loadAllData",
    );
    assert.equal(
      h.calls.bootstrap,
      0,
      "the wizard create path must NOT run the dashboard bootstrap",
    );
    assert.equal(
      h.calls.discovery,
      0,
      "the wizard create path must NOT trigger discovery setup",
    );
    assert.equal(
      h.calls.open,
      1,
      "the wizard create path must open the new spreadsheet in a new tab (window.open) — the wizard stays put in THIS tab",
    );
  });

  it("a racing dashboard-reveal entry point cannot reveal the dashboard or tear down the wizard while it owns the surface", async () => {
    const h = loadIntegratedHarness({ initialSheetId: "preexisting-sheet-id" });
    h.wizard.reopenFirstRunWizard();
    assert.equal(h.wizard.isFirstRunWizardVisible(), true);

    // Simulate the slow page-load restoreOAuthSession resolving its
    // loadAllData().then(revealDashboardShell) AFTER the wizard has painted.
    h.setup.revealDashboardShell();

    assert.notEqual(
      h.document.getElementById("dashboard").style.display,
      "block",
      "revealDashboardShell must be a no-op while the first-run wizard owns the surface",
    );
    assert.equal(
      h.wizard.isFirstRunWizardVisible(),
      true,
      "the wizard must remain visible when a stray reveal fires",
    );
  });

  it("reveals the dashboard again once the wizard releases the surface (dismissed/finished)", async () => {
    const h = loadIntegratedHarness({ initialSheetId: "preexisting-sheet-id" });
    h.wizard.reopenFirstRunWizard();
    h.wizard.hideFirstRunWizard();
    assert.equal(h.wizard.isFirstRunWizardVisible(), false);

    h.setup.revealDashboardShell();
    assert.equal(
      h.document.getElementById("dashboard").style.display,
      "block",
      "once the wizard is closed the dashboard reveal proceeds normally",
    );
  });

  it("the onboarding (non-wizard) create path still hands off to the dashboard", async () => {
    const h = loadIntegratedHarness({ initialSheetId: "" });
    // No wizard shown: onboarding context owns the surface, so the full
    // dashboard handoff must still run.
    assert.equal(h.wizard.isFirstRunWizardVisible(), false);

    await h.setup.handleSetupCreateStarterSheet({ context: "onboarding" });
    await flush();

    assert.equal(
      h.document.getElementById("dashboard").style.display,
      "block",
      "onboarding create must reveal the dashboard shell",
    );
    assert.equal(h.calls.loadAll, 1, "onboarding create must loadAllData");
    assert.equal(
      h.calls.bootstrap,
      1,
      "onboarding create must run the dashboard bootstrap",
    );
    assert.equal(
      h.calls.discovery,
      1,
      "onboarding create must trigger discovery setup",
    );
    assert.equal(
      h.calls.open,
      1,
      "onboarding create must open the new spreadsheet tab",
    );
  });
});
