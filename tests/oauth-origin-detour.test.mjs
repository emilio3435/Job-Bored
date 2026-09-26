import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { loadArrival, renderedText } from "./oneflow-l1-harness.mjs";

/* ============================================================
   B1 OAuth detour routing — origin/client failures land on the fix.

   auth-session.js classifies GIS failures whose fragments smell like an
   origin/client misconfiguration (invalid_client, origin, 401) and
   deep-opens Beat 1 with the rejected address; oneflow-beat-google.js
   renders that address first with its Copy control, auto-expands the
   detour, and carries an origin-mismatch recovery case.

   Two harnesses: a VM slice of auth-session.js (same section markers as
   oauth-session-storage-boundary.test.mjs) and the L1 arrival sandbox.
   ============================================================ */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const authSessionJs = readFileSync(join(repoRoot, "auth-session.js"), "utf8");
const AUTH_SECTION_START = authSessionJs.indexOf("let accessToken = null;");
const AUTH_SECTION_END = authSessionJs.indexOf(
  "// ============================================\n// TOAST SYSTEM",
);
const AUTH_GIS_SECTION_START = authSessionJs.indexOf(
  "// ============================================\n// AUTH — Google Identity Services",
);
const AUTH_GIS_SECTION_END = authSessionJs.indexOf(
  "function setupAuthUI",
  AUTH_GIS_SECTION_START,
);

if (
  AUTH_SECTION_START === -1 ||
  AUTH_SECTION_END === -1 ||
  AUTH_GIS_SECTION_START === -1 ||
  AUTH_GIS_SECTION_END === -1
) {
  throw new Error(
    "Could not isolate the auth session section from auth-session.js",
  );
}

const authSectionSource = authSessionJs.slice(
  AUTH_SECTION_START,
  AUTH_SECTION_END,
);
const authInteractiveSource = [
  authSectionSource,
  authSessionJs.slice(AUTH_GIS_SECTION_START, AUTH_GIS_SECTION_END),
].join("\n");

/** VM preamble: host()/sheetId() helpers the extracted module expects at runtime. */
const authVmPreamble = `
function sheetId() {
  return String(SHEET_ID || "").trim();
}
function host() {
  return {
    getOAuthClientId,
    getSHEET_ID: () => SHEET_ID,
    getSheetId: () => SHEET_ID,
    setPendingSetupStarterSheetCreate(value) {
      pendingSetupStarterSheetCreate = !!value;
    },
    getPendingSetupStarterSheetCreate() {
      return pendingSetupStarterSheetCreate;
    },
    loadAllData,
    revealDashboardShell() {},
    revealSetupScreenAfterAuth,
    showSheetAccessGate,
    showToast,
    maybeSyncSettingsModalModeAfterAuth,
    renderAppsScriptDeployUi() {},
    recordSheetAccessError() {},
    renderPipeline() {},
    setPipelineRawRows() {},
    setPipelineData() {},
    setDashboardDataHydrated() {},
    setInitialSheetAccessResolved() {},
    handleSetupCreateStarterSheet() {},
    escapeHtml(value) {
      return String(value);
    },
  };
}
`;
const GOOGLE_SIGNIN_SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
].join(" ");
const hostSetTimeout = setTimeout;
const hostClearTimeout = clearTimeout;

function createStorage() {
  const storage = new Map();
  return {
    getItem(key) {
      return storage.has(key) ? storage.get(key) : null;
    },
    setItem(key, value) {
      storage.set(key, String(value));
    },
    removeItem(key) {
      storage.delete(key);
    },
  };
}

function createDetourHarness({
  oauthClientId = "client_123",
  pageOrigin = "http://localhost:8080",
} = {}) {
  const localStorage = createStorage();
  const sessionStorage = createStorage();
  const toasts = [];
  const flowCalls = { open: [], seedRuntime: [] };
  const initTokenClientCalls = [];
  const context = vm.createContext({
    console,
    Date,
    localStorage,
    sessionStorage,
    document: { getElementById: () => null },
    window: {
      location: { origin: pageOrigin },
      JobBoredOneFlow: {
        open(...args) {
          flowCalls.open.push(args);
          return Promise.resolve(true);
        },
        seedRuntime(partial) {
          flowCalls.seedRuntime.push(partial);
          return partial;
        },
      },
    },
    google: {
      accounts: {
        oauth2: {
          initTokenClient(options) {
            initTokenClientCalls.push(options);
            return {
              requestAccessToken() {},
            };
          },
        },
      },
    },
    setTimeout(callback, delay, ...args) {
      const timer = hostSetTimeout(callback, delay, ...args);
      timer.unref?.();
      return timer;
    },
    clearTimeout: hostClearTimeout,
    fetch: async () => ({ ok: false, status: 403 }),
    GOOGLE_SIGNIN_SCOPES,
    GIS_INIT_STUCK_MS: 8000,
    SESSION_ENDED_GATE: {
      title: "Your Google session ended",
      detail: "Sign in again to pick up where you left off.",
    },
    pendingSetupStarterSheetCreate: false,
    SHEET_ID: "",
    __oauthClientId: oauthClientId,
    __tokenRequests: [],
    getOAuthClientId() {
      return context.__oauthClientId;
    },
    updateAuthUI() {},
    fetchUserEmail() {},
    loadAllData() {},
    revealSetupScreenAfterAuth() {},
    showSheetAccessGate() {},
    setupAuthUI() {},
    showToast(message, type, persistent) {
      toasts.push({ message, type, persistent });
    },
    maybeSyncSettingsModalModeAfterAuth() {},
    renderAppsScriptDeployUi() {},
  });

  vm.runInContext(authVmPreamble + authInteractiveSource, context, {
    filename: "auth-session.js#oauth-origin-detour",
  });

  return {
    toasts,
    flowCalls,
    initTokenClientCalls,
    context,
    run(source) {
      return vm.runInContext(source, context);
    },
  };
}

describe("OAuth origin/client classification (auth-session.js)", () => {
  it("matches the documented heuristic substrings across every fragment field", () => {
    const harness = createDetourHarness();
    const yes = [
      "isOAuthOriginClientFailure({ error: 'invalid_client' })",
      "isOAuthOriginClientFailure({ error_description: 'Error 401: invalid client' })",
      "isOAuthOriginClientFailure({ message: 'Not a valid origin for the client' })",
      "isOAuthOriginClientFailure({ type: 'idpiframe_initialization_failed', details: 'Not a valid origin' })",
      "isOAuthOriginClientFailure('401 Unauthorized')",
      "isOAuthOriginClientFailure({ error: 'INVALID_CLIENT' })",
    ];
    for (const source of yes) {
      assert.equal(harness.run(source), true, source);
    }
  });

  it("leaves popup, consent, and empty failures unclassified", () => {
    const harness = createDetourHarness();
    const no = [
      "isOAuthOriginClientFailure({ type: 'popup_closed' })",
      "isOAuthOriginClientFailure({ type: 'popup_failed' })",
      "isOAuthOriginClientFailure({ error: 'access_denied' })",
      "isOAuthOriginClientFailure(null)",
      "isOAuthOriginClientFailure(undefined)",
      "isOAuthOriginClientFailure('')",
      "isOAuthOriginClientFailure({})",
    ];
    for (const source of no) {
      assert.equal(harness.run(source), false, source);
    }
  });

  it("handleTokenResponse deep-opens Beat 1 with the failing origin on a classified failure", () => {
    const harness = createDetourHarness();
    harness.run(`
      handleTokenResponse({
        error: 'invalid_client',
        error_description: '401. The JavaScript origin is not allowed for this client.',
      });
    `);
    // Field assertions, not deepEqual: the payloads cross the VM boundary,
    // so their prototypes differ from this realm's literals.
    assert.equal(harness.flowCalls.seedRuntime.length, 1);
    assert.equal(
      harness.flowCalls.seedRuntime[0].failingOrigin,
      "http://localhost:8080",
    );
    assert.equal(harness.flowCalls.open.length, 1);
    assert.equal(harness.flowCalls.open[0][0], "google");
    assert.equal(harness.flowCalls.open[0][1].returnTo, "close");
    assert.equal(harness.toasts.length, 1);
    assert.equal(harness.toasts[0].type, "error");
    assert.match(harness.toasts[0].message, /Continue with Google/);
    assert.equal(
      /invalid_client|401/.test(harness.toasts[0].message),
      false,
      "the toast speaks user words, never the raw Google fragment",
    );
  });

  it("handleTokenResponse keeps generic failures as user words, never a raw dump", () => {
    const harness = createDetourHarness();
    harness.run(`
      handleTokenResponse({
        error: 'access_denied',
        error_description: 'The user denied the request.',
      });
    `);
    assert.equal(harness.flowCalls.open.length, 0);
    assert.equal(harness.toasts.length, 1);
    assert.equal(
      /access_denied|denied the request/.test(harness.toasts[0].message),
      false,
      "no raw error_description reaches the toast",
    );
    assert.match(harness.toasts[0].message, /Try again/);
  });

  it("GIS error_callback deep-opens Beat 1 on a classified failure, not on a popup failure", () => {
    const harness = createDetourHarness();
    harness.run("initAuth()");
    assert.equal(harness.initTokenClientCalls.length, 1);
    const errorCallback = harness.initTokenClientCalls[0].error_callback;

    errorCallback({ message: "idpiframe_initialization_failed: not a valid origin" });
    assert.equal(harness.flowCalls.seedRuntime.length, 1);
    assert.equal(
      harness.flowCalls.seedRuntime[0].failingOrigin,
      "http://localhost:8080",
    );
    assert.equal(harness.flowCalls.open.length, 1);
    assert.equal(harness.flowCalls.open[0][0], "google");
    assert.equal(harness.flowCalls.open[0][1].returnTo, "close");
    assert.match(harness.toasts[0].message, /Continue with Google/);

    const opensBefore = harness.flowCalls.open.length;
    errorCallback({ type: "popup_closed" });
    assert.equal(
      harness.flowCalls.open.length,
      opensBefore,
      "popup failures keep their own message, not the detour",
    );
    assert.match(harness.toasts.at(-1).message, /popup/i);
  });

  it("re-init error_callback classifies origin failures too", () => {
    const harness = createDetourHarness();
    harness.run("initAuth()");
    harness.run(
      "applyOAuthClientChange('reinit-test.apps.googleusercontent.com')",
    );
    assert.equal(harness.initTokenClientCalls.length, 2);
    const reinitCallback = harness.initTokenClientCalls[1].error_callback;
    reinitCallback({ error: "invalid_client" });
    assert.equal(harness.flowCalls.open.length, 1);
    assert.equal(harness.flowCalls.open[0][0], "google");
    assert.equal(harness.flowCalls.open[0][1].returnTo, "close");
    assert.match(harness.toasts[0].message, /Continue with Google/);
  });
});

describe("B1 detour with a failing origin (oneflow-beat-google.js)", () => {
  const FAILING = "http://4721.example:9999";

  async function openBeatWithFailingOrigin(failingOrigin) {
    const env = loadArrival();
    env.flow.seedRuntime({ failingOrigin });
    await env.flow.open("google");
    return env;
  }

  it("auto-expands the detour and renders the rejected address first with Copy", async () => {
    const env = await openBeatWithFailingOrigin(FAILING);
    const details = env.mount().querySelector(".oneflow-google__detour");
    assert.ok(details, "the detour still renders");
    assert.equal(
      details.open,
      true,
      "a deep-opened detour opens itself — the fix is the screen",
    );
    const failing = env.mount().querySelector(
      ".oneflow-google__detour-failing-origin",
    );
    assert.ok(failing, "the rejected address renders");
    assert.match(failing.textContent, new RegExp(FAILING.replaceAll(".", "\\.")));
    const kids = details.children;
    const failingIdx = kids.findIndex((k) =>
      k.classList.contains("oneflow-google__detour-failing-origin"),
    );
    const originIdx = kids.findIndex((k) =>
      k.classList.contains("oneflow-google__detour-origin"),
    );
    assert.ok(failingIdx !== -1 && originIdx !== -1);
    assert.ok(
      failingIdx < originIdx,
      "the rejected address renders BEFORE the page-origin row",
    );
    failing.querySelector(".oneflow-google__detour-copy").dispatch("click");
    const copy = env.host.__calls.find(
      (c) => c.name === "copyTextToClipboard",
    );
    assert.ok(copy, "the existing Copy pattern carries the rejected address");
    assert.equal(copy.args[0], FAILING);
  });

  it("renders the failing note with the next action", async () => {
    const env = await openBeatWithFailingOrigin(FAILING);
    const note = env.mount().querySelector(
      ".oneflow-google__detour-failing-note",
    );
    assert.ok(note);
    assert.match(note.textContent, /Authorized JavaScript origins/);
    assert.match(note.textContent, /press Continue with Google again/);
  });

  it("skips the duplicate page-origin row when it matches the rejected address", async () => {
    const env = loadArrival();
    env.flow.seedRuntime({ failingOrigin: "http://localhost:8080" });
    await env.flow.open("google");
    assert.ok(
      env.mount().querySelector(".oneflow-google__detour-failing-origin"),
      "the rejected address still renders",
    );
    assert.equal(
      env.mount().querySelector(".oneflow-google__detour-origin"),
      null,
      "the same address twice would read as two different things to paste",
    );
  });

  it("leaves the normal path unchanged: collapsed detour, no failing row", async () => {
    const env = loadArrival();
    await env.flow.open("google");
    const details = env.mount().querySelector(".oneflow-google__detour");
    assert.ok(details);
    assert.ok(!details.open, "collapsed until the user opens it");
    assert.equal(
      env.mount().querySelector(".oneflow-google__detour-failing-origin"),
      null,
    );
  });

  it("carries an origin-mismatch case in Having-trouble that ends in retrying Continue", async () => {
    const env = loadArrival();
    await env.flow.open("google");
    const trouble = env.mount().querySelector(
      ".oneflow-google__detour-trouble",
    );
    assert.ok(trouble);
    assert.match(trouble.textContent, /unauthorized origin/);
    assert.match(trouble.textContent, /Error 401: invalid client/);
    assert.match(
      trouble.textContent,
      /press Continue with Google again/,
      "voice §8.4: the recovery ends in the retry",
    );
  });

  it("B1 copy names no console, build, module, or terminal — only Google's own labels", async () => {
    const env = loadArrival();
    await env.flow.open("google");
    let text = renderedText(env.mount());
    // The runtime origin value (http://localhost:8080 in tests) is data,
    // not copy — strip every pasted URL before sweeping the words. (The
    // fake DOM matches classes/ids, not tag names, so strip by pattern.)
    text = text.replaceAll(/https?:\/\/\S+/g, "");
    // "Google Cloud Console" is the product's own name on its own button.
    text = text.replaceAll("Google Cloud Console", "");
    assert.equal(
      /console|terminal|module|build|localhost/i.test(text),
      false,
      `B1 copy must stay in user words: ${JSON.stringify(text.slice(0, 200))}`,
    );
  });
});
