import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const firstRunWizardJs = readFileSync(
  join(repoRoot, "first-run-wizard.js"),
  "utf8",
);
const sheetAccessSetupJs = readFileSync(
  join(repoRoot, "sheet-access-setup.js"),
  "utf8",
);

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

function loadWizard(hostStub) {
  const window = {
    JobBoredApp: { core: { host: hostStub || {} } },
    COMMAND_CENTER_CONFIG: {},
  };
  const document = makeRecordingDoc();
  // Deliberately omit setInterval so the 700ms refresh loop is a no-op.
  const ctx = {
    window,
    document,
    console,
    setTimeout,
    requestAnimationFrame: (fn) => fn(),
  };
  vm.createContext(ctx);
  vm.runInContext(firstRunWizardJs, ctx, { filename: "first-run-wizard.js" });
  return { api: window.JobBoredApp.firstRunWizard, window, document };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

// --- VAL-WIZ-012: wizard create stays in the wizard ----------------------

describe("first-run wizard — create stays in the wizard (VAL-WIZ-012)", () => {
  function createHost(over) {
    const state = { sheetId: "", signedIn: true };
    const calls = { reveal: 0, create: [] };
    const host = {
      getSheetId: () => state.sheetId,
      isSignedIn: () => state.signedIn,
      getOAuthClientId: () => "cid.apps.googleusercontent.com",
      getResumeGenerate: () => ({
        isResumeGenerationConfigured: () => false,
        getResumeGenerationConfig: () => ({ provider: "openrouter" }),
      }),
      revealDashboardShell: () => {
        calls.reveal += 1;
      },
      // Auth-free shim of the create primitive: simulate a successful
      // create + connect, then invoke the wizard's advance callback.
      handleSetupCreateStarterSheet: (opts) => {
        calls.create.push(opts);
        state.sheetId = "fake-spreadsheet-id";
        if (opts && typeof opts.onCreated === "function") {
          opts.onCreated({
            spreadsheetId: "fake-spreadsheet-id",
            spreadsheetUrl: "https://docs.google.com/spreadsheets/d/fake/edit",
          });
        }
        return Promise.resolve();
      },
      ...over,
    };
    return { host, state, calls };
  }

  it("a simulated successful create advances the wizard to the next step (not the dashboard)", async () => {
    const { host, calls } = createHost();
    const { api, document } = loadWizard(host);
    api.reopenFirstRunWizard();
    assert.equal(api.isFirstRunWizardVisible(), true);
    assert.equal(
      document.getElementById("firstRunPanelSheet").style.display,
      "block",
      "should start on the Sheet step",
    );

    document.getElementById("firstRunCreateSheetBtn").__fire("click", {});
    await tick();

    assert.equal(calls.create.length, 1, "should invoke the create primitive");
    assert.equal(
      calls.create[0].context,
      "wizard",
      "the wizard must pass a wizard context so the dashboard handoff is skipped",
    );
    assert.equal(
      api.isFirstRunWizardVisible(),
      true,
      "the wizard must stay open after a successful create",
    );
    assert.equal(
      document.getElementById("firstRunPanelSheet").style.display,
      "none",
      "the Sheet step must no longer be the active panel",
    );
    assert.equal(
      document.getElementById("firstRunPanelProvider").style.display,
      "block",
      "the wizard must advance to the next setup step (signed in -> provider)",
    );
    assert.equal(
      calls.reveal,
      0,
      "creating from the wizard must NOT reveal/hand off to the dashboard",
    );
  });

  it("shows a disabled 'Creating…' state while the create is in flight", async () => {
    const { host } = createHost({
      // Never resolves and never advances: lets us observe the in-flight state.
      handleSetupCreateStarterSheet: () => new Promise(() => {}),
    });
    const { api, document } = loadWizard(host);
    api.reopenFirstRunWizard();

    const btn = document.getElementById("firstRunCreateSheetBtn");
    btn.__fire("click", {});

    assert.equal(btn.disabled, true, "create button should be disabled");
    assert.equal(
      btn.textContent,
      "Creating…",
      "create button should show in-flight feedback",
    );
    assert.equal(
      api.isFirstRunWizardVisible(),
      true,
      "the wizard must stay open while creating",
    );
    assert.equal(
      document.getElementById("firstRunPanelSheet").style.display,
      "block",
      "the wizard must not advance until the create succeeds",
    );
  });
});

// --- sheet-access-setup.js: wizard context skips the dashboard handoff ----

describe("handleSetupCreateStarterSheet — wizard vs onboarding handoff", () => {
  function loadSetup() {
    const els = new Map();
    const fakeEl = () => ({ style: {}, disabled: false, textContent: "" });
    const document = {
      documentElement: { classList: { contains: () => false, remove() {} } },
      getElementById(id) {
        if (!els.has(id)) els.set(id, fakeEl());
        return els.get(id);
      },
    };

    const calls = {
      bootstrap: 0,
      loadAll: 0,
      discovery: 0,
      open: 0,
      onCreated: [],
      merge: [],
    };
    let coreSheetId = "";
    const hostStub = {
      getOAuthClientId: () => "cid.apps.googleusercontent.com",
      getAccessToken: () => "token",
      hasGrantedOauthScope: () => true,
      getGoogleSheetsScope: () =>
        "https://www.googleapis.com/auth/spreadsheets",
      getStarterPipelineHeaders: () => ["Company", "Role", "Status"],
      getStarterPipelineHeaderRange: () => "Pipeline!A1:C1",
      getSheetId: () => "",
      mergeStoredConfigOverridePatch: (patch) => calls.merge.push(patch),
      setInitialSheetAccessResolved: () => {},
      showToast: () => {},
      openCommandCenterSettingsModal: () => {},
      signIn: () => {},
      refreshAccessTokenSilently: async () => false,
      clearSessionAuthState: () => {},
      runPostAccessBootstrapOnce: async () => {
        calls.bootstrap += 1;
      },
      loadAllData: () => {
        calls.loadAll += 1;
      },
      requestDiscoverySetup: async () => {
        calls.discovery += 1;
      },
      hasPendingDiscoverySetup: () => false,
    };
    const coreStub = {
      host: hostStub,
      getGisLoaded: () => true,
      getTokenClient: () => ({}),
      setPendingSetupStarterSheetCreate: () => {},
      setSHEET_ID: (id) => {
        coreSheetId = id;
      },
      getSHEET_ID: () => coreSheetId,
    };
    const window = {
      JobBoredApp: { core: coreStub },
      location: { search: "" },
      open: () => {
        calls.open += 1;
      },
    };
    const fetchStub = async () => ({
      status: 200,
      ok: true,
      json: async () => ({
        spreadsheetId: "fake-spreadsheet-id",
        spreadsheetUrl: "https://docs.google.com/spreadsheets/d/fake/edit",
      }),
    });
    const ctx = {
      window,
      document,
      console,
      fetch: fetchStub,
      URLSearchParams,
      Date,
      encodeURIComponent,
      setInterval: () => 0,
      clearInterval: () => {},
    };
    vm.createContext(ctx);
    vm.runInContext(sheetAccessSetupJs, ctx, {
      filename: "sheet-access-setup.js",
    });
    return { api: window.JobBoredApp.setup, calls, document };
  }

  it("wizard context creates + connects WITHOUT the dashboard handoff and calls onCreated", async () => {
    const { api, calls, document } = loadSetup();
    const created = [];
    await api.handleSetupCreateStarterSheet({
      context: "wizard",
      onCreated: (info) => created.push(info),
    });

    assert.equal(created.length, 1, "onCreated must fire on success");
    assert.equal(created[0].spreadsheetId, "fake-spreadsheet-id");
    assert.equal(
      calls.merge.length,
      1,
      "the new sheet id must be persisted exactly once",
    );
    assert.equal(
      calls.merge[0].sheetId,
      "fake-spreadsheet-id",
      "the new sheet id must be persisted via mergeStoredConfigOverridePatch",
    );
    assert.equal(
      calls.bootstrap,
      0,
      "wizard create must NOT run the dashboard bootstrap",
    );
    assert.equal(calls.loadAll, 0, "wizard create must NOT call loadAllData");
    assert.equal(
      calls.discovery,
      0,
      "wizard create must NOT trigger discovery setup",
    );
    assert.equal(
      calls.open,
      1,
      "wizard create must open the new spreadsheet in a new tab (window.open) — the wizard stays put in THIS tab",
    );
    assert.notEqual(
      document.getElementById("dashboard").style.display,
      "block",
      "wizard create must NOT reveal the dashboard shell",
    );
  });

  it("default onboarding context still hands off to the dashboard (no regression)", async () => {
    const { api, calls, document } = loadSetup();
    await api.handleSetupCreateStarterSheet();

    assert.equal(
      calls.bootstrap,
      1,
      "onboarding create must still run the dashboard bootstrap",
    );
    assert.equal(calls.loadAll, 1, "onboarding create must still loadAllData");
    assert.equal(
      calls.discovery,
      1,
      "onboarding create must still trigger discovery setup",
    );
    assert.equal(
      calls.open,
      1,
      "onboarding create must still open the new spreadsheet",
    );
    assert.equal(
      document.getElementById("dashboard").style.display,
      "block",
      "onboarding create must reveal the dashboard shell",
    );
  });
});

// --- Source guard: the default discovery handoff is preserved -------------

describe("source: wizard handoff option is threaded, default preserved", () => {
  it("first-run-wizard passes a wizard context + onCreated advance callback", () => {
    const start = firstRunWizardJs.indexOf(
      "function handleFirstRunCreateSheet",
    );
    const end = firstRunWizardJs.indexOf("function handleFirstRunPasteSheet");
    assert.ok(start !== -1 && end !== -1, "should isolate handleFirstRunCreateSheet");
    const body = firstRunWizardJs.slice(start, end);
    assert.match(
      body,
      /context:\s*"wizard"/,
      "wizard create must pass a wizard context",
    );
    assert.ok(
      body.includes("onCreated"),
      "wizard create must provide an onCreated advance callback",
    );
    assert.ok(
      /Creating/.test(body),
      "wizard create must set a 'Creating…' in-flight label",
    );
  });

  it("handleSetupCreateStarterSheet keeps the default dashboard handoff for non-wizard creates", () => {
    const start = sheetAccessSetupJs.indexOf(
      "async function handleSetupCreateStarterSheet",
    );
    const end = sheetAccessSetupJs.indexOf(
      "function initSetupAndSheetAccessActions",
      start,
    );
    const body = sheetAccessSetupJs.slice(start, end);
    assert.ok(
      body.includes("await host().runPostAccessBootstrapOnce()"),
      "default path must still await the post-access bootstrap",
    );
    assert.ok(
      body.includes(
        'await host().requestDiscoverySetup({ entryPoint: "starter_sheet_created" })',
      ),
      "default path must still use the shared discovery deferral helper",
    );
    assert.ok(
      body.includes("skipDashboardHandoff") || body.includes('context === "wizard"'),
      "the function must branch on a wizard/skip-handoff flag",
    );
  });
});
