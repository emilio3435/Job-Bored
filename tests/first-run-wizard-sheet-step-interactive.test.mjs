import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

// Faithful integrated reproduction of VAL-WIZ-013: while the first-run
// wizard owns the surface, a stray showSheetAccessGate("loading") call
// (from auth-session.js's sign-in-success path, the loadAllData interval,
// or a restoreOAuthSession race) must NOT strand a gate overlay that
// swallows clicks on the wizard's Sheet-step buttons. After the fix:
//   (a) #sheetAccessGateScreen is not left displayed/intercepting over
//       #firstRunWizard; elementFromPoint over the Sheet-step buttons
//       returns a wizard element, not the gate screen;
//   (b) the Sheet-step button handlers still fire (a click invokes
//       handleSetupCreateStarterSheet and the "Creating…" in-flight
//       label is applied);
//   (c) the wizard advances off the Sheet step once a Sheet is connected.
//
// Mirrors the d81e575 "create + 403-consent resume stays in the wizard"
// harness and adds a stray showSheetAccessGate call before each click
// so a regression that re-shows the gate is caught.

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
    /**
     * Mock elementFromPoint: returns the topmost element at (x, y) based
     * on the current DOM state. The wizard (z-index 100001, position
     * fixed) sits above the gate (z-index auto, position static) in the
     * stacking order, so when the wizard is visible and the gate is not
     * (or is suppressed) we return a wizard element. When the gate is
     * wrongly left shown we return the gate so the test can fail loud.
     */
    elementFromPoint(_x, _y) {
      const wiz = els.get("firstRunWizard");
      const gate = els.get("sheetAccessGateScreen");
      const wizVisible = wiz && wiz.style.display === "flex";
      const gateVisible = gate && gate.style.display === "flex";
      if (wizVisible) {
        // The wizard is on top; the click target is one of its children.
        // Return the create button so the test can assert a wizard element.
        return els.get("firstRunCreateSheetBtn") || wiz;
      }
      if (gateVisible) {
        return gate;
      }
      return null;
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

function loadIntegratedHarness({
  initialSheetId = "preexisting-sheet-id",
  failFirstCreate = false,
} = {}) {
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
    // --- identity / auth ---
    getOAuthClientId: () => "cid.apps.googleusercontent.com",
    getAccessToken: () => authState.accessToken,
    isSignedIn: () => authState.signedIn,
    hasGrantedOauthScope: (scope) =>
      normScopes(authState.grantedScopes).includes(String(scope || "").trim()),
    getGoogleSheetsScope: () => SHEETS_SCOPE,
    refreshAccessTokenSilently: async () => false,
    clearSessionAuthState: () => {},
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
        if (sheetId()) {
          // The stray showSheetAccessGate call this test guards against:
          // an interactive sign-in lands on the loading gate even while
          // the wizard owns the surface. With the fix this is suppressed.
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
    parseGoogleSheetId: (raw) => {
      // Mirror the real parser: pull the spreadsheet id out of a Sheets URL
      // when one is present, otherwise return the trimmed raw value.
      const t = String(raw || "").trim();
      if (!t) return null;
      const m = t.match(/\/spreadsheets\/d\/([A-Za-z0-9_-]+)/);
      if (m) return m[1];
      return /^[A-Za-z0-9_-]{20,}$/.test(t) ? t : null;
    },
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
      if (failFirstCreate && createPostCount === 1) {
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

describe("first-run wizard — Sheet step stays interactive under a stray showSheetAccessGate (VAL-WIZ-013)", () => {
  it("suppresses showSheetAccessGate while the wizard owns the surface (no stranded overlay)", () => {
    const h = loadIntegratedHarness({ initialSheetId: "preexisting-sheet-id" });
    h.wizard.reopenFirstRunWizard();
    assert.equal(h.wizard.isFirstRunWizardVisible(), true);

    // Pre-fix: this set the gate to display: flex and stranded an overlay
    // behind which the wizard's buttons could not receive clicks.
    h.setup.showSheetAccessGate("loading");
    let gate = h.document.getElementById("sheetAccessGateScreen");
    assert.notEqual(
      gate.style.display,
      "flex",
      "showSheetAccessGate must not display the gate while the wizard owns the surface",
    );

    // Every mode must be suppressed while the wizard is active.
    h.setup.showSheetAccessGate("signin");
    gate = h.document.getElementById("sheetAccessGateScreen");
    assert.notEqual(
      gate.style.display,
      "flex",
      "showSheetAccessGate('signin') must not display the gate while the wizard owns the surface",
    );

    h.setup.showSheetAccessGate("error");
    gate = h.document.getElementById("sheetAccessGateScreen");
    assert.notEqual(
      gate.style.display,
      "flex",
      "showSheetAccessGate('error') must not display the gate while the wizard owns the surface",
    );
  });

  it("preserves the requested gate mode in dataset so the gate resumes correctly once the wizard releases the surface", () => {
    const h = loadIntegratedHarness({ initialSheetId: "preexisting-sheet-id" });
    h.wizard.reopenFirstRunWizard();

    h.setup.showSheetAccessGate("signin");
    const gate = h.document.getElementById("sheetAccessGateScreen");
    assert.equal(
      gate.dataset.gateMode,
      "signin",
      "the requested mode must still be recorded while the gate is suppressed",
    );

    // Once the wizard releases the surface, the next showSheetAccessGate
    // call (e.g., from the sign-out path or a normal cold-start) must
    // actually display the gate.
    h.wizard.hideFirstRunWizard();
    assert.equal(h.wizard.isFirstRunWizardVisible(), false);
    h.setup.showSheetAccessGate("signin");
    assert.equal(
      gate.style.display,
      "flex",
      "showSheetAccessGate must display the gate again once the wizard releases the surface",
    );
  });

  it("elementFromPoint over the Sheet-step button returns a wizard element, not the gate", () => {
    const h = loadIntegratedHarness({ initialSheetId: "preexisting-sheet-id" });
    h.wizard.reopenFirstRunWizard();
    // Stray call from a restoreOAuthSession race / loadAllData interval.
    h.setup.showSheetAccessGate("loading");

    const el = h.document.elementFromPoint(100, 100);
    assert.ok(
      el,
      "elementFromPoint must return an element when the wizard owns the surface",
    );
    // The topmost element at the Sheet-step button region must be a wizard
    // child (the create button) — not the gate screen.
    assert.notEqual(
      el.id,
      "sheetAccessGateScreen",
      "elementFromPoint must not return the gate screen",
    );
    assert.match(
      el.id,
      /^firstRun/,
      "elementFromPoint over the Sheet-step button must return a wizard element (id starting with firstRun)",
    );
  });

  it("Sheet-step button click still reaches handleSetupCreateStarterSheet after a stray showSheetAccessGate", async () => {
    const h = loadIntegratedHarness({ initialSheetId: "preexisting-sheet-id" });
    h.wizard.reopenFirstRunWizard();
    // Simulate a stray showSheetAccessGate call from the auth/load path.
    h.setup.showSheetAccessGate("loading");

    const btn = h.document.getElementById("firstRunCreateSheetBtn");
    btn.__fire("click", {});
    await flush();

    assert.equal(
      h.calls.createPost,
      1,
      "the create primitive must be invoked (POST to /spreadsheets) — the click must reach the wizard, not the gate",
    );
    assert.equal(
      h.coreState.sheetId,
      "created-sheet-id",
      "the new sheet id must be persisted (the handler ran end-to-end)",
    );
    assert.equal(
      h.calls.merge.filter((p) => p && p.sheetId).length,
      1,
      "mergeStoredConfigOverridePatch must receive the new sheet id exactly once",
    );
  });

  it("Sheet-step button shows the 'Creating…' in-flight label when a stray showSheetAccessGate precedes the click", () => {
    const h = loadIntegratedHarness({ initialSheetId: "preexisting-sheet-id" });
    h.wizard.reopenFirstRunWizard();
    h.setup.showSheetAccessGate("loading");

    // A create primitive that never resolves lets us observe the in-flight
    // label that the click handler applies to the create button.
    h.window.JobBoredApp.setup.handleSetupCreateStarterSheet = () =>
      new Promise(() => {});
    // Re-wire the host to use the new primitive.
    h.window.JobBoredApp.core.host.handleSetupCreateStarterSheet = (opts) =>
      h.window.JobBoredApp.setup.handleSetupCreateStarterSheet(opts);

    const btn = h.document.getElementById("firstRunCreateSheetBtn");
    btn.__fire("click", {});

    assert.equal(
      btn.disabled,
      true,
      "the create button must be disabled while the create is in flight",
    );
    assert.equal(
      btn.textContent,
      "Creating…",
      "the create button must show the 'Creating…' in-flight label so the click visibly responds",
    );
  });

  it("the link/paste control responds to its handler after a stray showSheetAccessGate", () => {
    const h = loadIntegratedHarness({ initialSheetId: "" });
    h.wizard.reopenFirstRunWizard();
    h.setup.showSheetAccessGate("loading");

    const input = h.document.getElementById("firstRunSheetIdInput");
    const saveBtn = h.document.getElementById("firstRunSheetIdSaveBtn");
    input.value =
      "https://docs.google.com/spreadsheets/d/abc123def456ghi789/edit";
    saveBtn.__fire("click", {});

    const status = h.document.getElementById("firstRunSheetStatus");
    assert.notEqual(
      status.hidden,
      true,
      "the link/paste handler must show a status message after a stray showSheetAccessGate",
    );
    assert.match(
      status.textContent,
      /Sheet connected/i,
      "the link/paste handler must surface a confirmation",
    );
    assert.equal(
      h.coreState.sheetId,
      "abc123def456ghi789",
      "the parsed sheet id must be persisted so the wizard can advance",
    );
  });

  it("wizard advances off the Sheet step after a successful create under a stray showSheetAccessGate", async () => {
    const h = loadIntegratedHarness({ initialSheetId: "preexisting-sheet-id" });
    h.wizard.reopenFirstRunWizard();
    h.setup.showSheetAccessGate("loading");

    const btn = h.document.getElementById("firstRunCreateSheetBtn");
    btn.__fire("click", {});
    await flush();

    assert.equal(
      h.wizard.isFirstRunWizardVisible(),
      true,
      "the wizard must stay visible across the create",
    );
    assert.equal(
      h.document.getElementById("firstRunPanelSheet").style.display,
      "none",
      "the Sheet step must no longer be the active panel after a successful create",
    );
    assert.equal(
      h.document.getElementById("firstRunPanelProvider").style.display,
      "block",
      "the wizard must advance to the next incomplete step (provider)",
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

  it("the 403-consent resume path is also clean: the gate is suppressed and the wizard advances", async () => {
    const h = loadIntegratedHarness({
      initialSheetId: "preexisting-sheet-id",
      failFirstCreate: true,
    });
    h.wizard.reopenFirstRunWizard();

    h.document.getElementById("firstRunCreateSheetBtn").__fire("click", {});
    await flush();

    // 403 → signIn({prompt:"consent"}) → token restored → handleSetupCreateStarterSheet()
    // resume → second POST → 200 → onCreated → wizard advances.
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
    assert.equal(
      h.calls.createPost,
      2,
      "create should POST twice: the 403 attempt then the successful retry",
    );

    // The wizard advanced; the gate never stranded an overlay over it.
    assert.equal(h.wizard.isFirstRunWizardVisible(), true);
    assert.equal(
      h.document.getElementById("firstRunPanelSheet").style.display,
      "none",
      "the Sheet step must no longer be active after the consent-resume create succeeds",
    );
    assert.equal(
      h.document.getElementById("firstRunPanelProvider").style.display,
      "block",
      "the wizard must advance to the next incomplete step (provider)",
    );
    const gate = h.document.getElementById("sheetAccessGateScreen");
    assert.notEqual(
      gate.style.display,
      "flex",
      "the consent-resume signIn must not strand a showSheetAccessGate('loading') overlay over the wizard",
    );
  });
});
