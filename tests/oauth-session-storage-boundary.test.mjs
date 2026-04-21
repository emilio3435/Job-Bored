import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const appJs = readFileSync(join(repoRoot, "app.js"), "utf8");
const AUTH_SECTION_START = appJs.indexOf("let accessToken = null;");
const AUTH_SECTION_END = appJs.indexOf(
  "// ============================================\n// TOAST SYSTEM",
);
const AUTH_GIS_SECTION_START = appJs.indexOf(
  "// ============================================\n// AUTH — Google Identity Services",
);
const AUTH_GIS_SECTION_END = appJs.indexOf(
  "function setupAuthUI",
  AUTH_GIS_SECTION_START,
);

if (
  AUTH_SECTION_START === -1 ||
  AUTH_SECTION_END === -1 ||
  AUTH_GIS_SECTION_START === -1 ||
  AUTH_GIS_SECTION_END === -1
) {
  throw new Error("Could not isolate the auth session section from app.js");
}

const authSectionSource = appJs.slice(AUTH_SECTION_START, AUTH_SECTION_END);
const authInteractiveSource = [
  authSectionSource,
  appJs.slice(AUTH_GIS_SECTION_START, AUTH_GIS_SECTION_END),
].join("\n");
const OAUTH_SESSION_STORAGE_KEY = "command_center_oauth_session";
const OAUTH_RUNTIME_SESSION_STORAGE_KEY = "command_center_oauth_runtime";
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

function createAuthHarness({
  oauthClientId = "client_123",
  includeInteractive = false,
} = {}) {
  const localStorage = createStorage();
  const sessionStorage = createStorage();
  const calls = {
    updateAuthUI: 0,
    fetchUserEmail: 0,
    loadAllData: 0,
    revealSetupScreenAfterAuth: 0,
    showSheetAccessGate: [],
    showToast: [],
  };
  const context = vm.createContext({
    console,
    localStorage,
    sessionStorage,
    setTimeout(callback, delay, ...args) {
      const timer = hostSetTimeout(callback, delay, ...args);
      timer.unref?.();
      return timer;
    },
    clearTimeout: hostClearTimeout,
    fetch: async () => ({ ok: false, status: 403 }),
    GOOGLE_SIGNIN_SCOPES,
    pendingSetupStarterSheetCreate: false,
    SHEET_ID: "",
    __oauthClientId: oauthClientId,
    __tokenRequests: [],
    getOAuthClientId() {
      return context.__oauthClientId;
    },
    updateAuthUI() {
      calls.updateAuthUI += 1;
    },
    fetchUserEmail() {
      calls.fetchUserEmail += 1;
    },
    loadAllData() {
      calls.loadAllData += 1;
    },
    revealSetupScreenAfterAuth() {
      calls.revealSetupScreenAfterAuth += 1;
    },
    showSheetAccessGate(mode) {
      calls.showSheetAccessGate.push(mode);
    },
    showToast(message, type, persistent) {
      calls.showToast.push({ message, type, persistent });
    },
    maybeSyncSettingsModalModeAfterAuth() {},
    renderSetupStarterSheetUi() {},
    renderAppsScriptDeployUi() {},
  });

  vm.runInContext(
    includeInteractive ? authInteractiveSource : authSectionSource,
    context,
    {
      filename: "app.js#auth-session-boundary",
    },
  );

  vm.runInContext(
    `
      tokenClient = {
        requestAccessToken(request) {
          globalThis.__tokenRequests.push(request);
        },
      };
    `,
    context,
  );

  return {
    calls,
    context,
    localStorage,
    sessionStorage,
    setOAuthClientId(nextValue) {
      context.__oauthClientId = nextValue;
    },
    run(source) {
      return vm.runInContext(source, context);
    },
  };
}

describe("OAuth session storage boundary", () => {
  it("persists session marker separately from the runtime token", () => {
    const harness = createAuthHarness();
    harness.run(`
      accessToken = "opaque-session-123";
      tokenExpiresAt = 1234567890;
      userEmail = "user@example.com";
      userPictureUrl = "https://example.com/avatar.png";
      grantedOauthScopes = "scope-a scope-a scope-b";
      persistOAuthSession();
    `);

    const stored = JSON.parse(
      harness.localStorage.getItem(OAUTH_SESSION_STORAGE_KEY),
    );
    assert.equal(stored.oauthClientId, "client_123");
    assert.equal(stored.hasOauthSession, true);
    assert.equal(stored.accessToken, undefined);
    assert.equal(stored.userEmail, "user@example.com");

    const runtimeStored = JSON.parse(
      harness.localStorage.getItem(OAUTH_RUNTIME_SESSION_STORAGE_KEY),
    );
    assert.equal(runtimeStored.accessToken, "opaque-session-123");
    assert.equal(runtimeStored.oauthClientId, "client_123");
    assert.equal(
      harness.sessionStorage.getItem(OAUTH_RUNTIME_SESSION_STORAGE_KEY),
      null,
    );
  });

  it("clears stale persisted state when the OAuth client ID changes", () => {
    const harness = createAuthHarness();
    harness.localStorage.setItem(
      OAUTH_SESSION_STORAGE_KEY,
      JSON.stringify({
        hasOauthSession: true,
        expiresAt: 1234567890,
        oauthClientId: "client_old",
      }),
    );
    harness.sessionStorage.setItem(
      OAUTH_RUNTIME_SESSION_STORAGE_KEY,
      JSON.stringify({
        hasOauthSession: true,
        accessToken: "opaque-session-123",
        expiresAt: Date.now() + 60_000,
        oauthClientId: "client_old",
      }),
    );

    harness.setOAuthClientId("client_new");
    const loaded = harness.run("loadPersistedOAuthSession()");
    const runtimeLoaded = harness.run("loadPersistedRuntimeOAuthSession()");

    assert.equal(loaded, null);
    assert.equal(runtimeLoaded, null);
    assert.equal(harness.localStorage.getItem(OAUTH_SESSION_STORAGE_KEY), null);
    assert.equal(
      harness.localStorage.getItem(OAUTH_RUNTIME_SESSION_STORAGE_KEY),
      null,
    );
    assert.equal(
      harness.sessionStorage.getItem(OAUTH_RUNTIME_SESSION_STORAGE_KEY),
      null,
    );
  });

  it("attempts silent restore only when a same-client session marker exists", () => {
    const harness = createAuthHarness();

    harness.run("restoreOAuthSession()");
    assert.deepEqual(harness.context.__tokenRequests, []);

    harness.localStorage.setItem(
      OAUTH_SESSION_STORAGE_KEY,
      JSON.stringify({
        hasOauthSession: true,
        expiresAt: Date.now() + 60_000,
        oauthClientId: "client_123",
      }),
    );
    harness.run("restoreOAuthSession()");

    assert.equal(harness.context.__tokenRequests.length, 1);
    assert.equal(harness.context.__tokenRequests[0].prompt, "none");
  });

  it("restores the same-client runtime token from sessionStorage before falling back to GIS", () => {
    const harness = createAuthHarness();
    harness.sessionStorage.setItem(
      OAUTH_RUNTIME_SESSION_STORAGE_KEY,
      JSON.stringify({
        hasOauthSession: true,
        accessToken: "opaque-session-123",
        expiresAt: Date.now() + 60_000,
        oauthClientId: "client_123",
        userEmail: "user@example.com",
        grantedOauthScopes: "scope-a scope-b",
      }),
    );

    harness.run("restoreOAuthSession()");

    assert.equal(harness.run("accessToken"), "opaque-session-123");
    assert.equal(harness.run("userEmail"), "user@example.com");
    assert.equal(harness.calls.updateAuthUI, 1);
    assert.equal(harness.calls.fetchUserEmail, 1);
    assert.equal(harness.context.__tokenRequests.length, 0);
  });

  it("clears the persisted marker when session auth state is dropped", () => {
    const harness = createAuthHarness();
    harness.localStorage.setItem(
      OAUTH_SESSION_STORAGE_KEY,
      JSON.stringify({
        hasOauthSession: true,
        expiresAt: Date.now() + 60_000,
        oauthClientId: "client_123",
      }),
    );
    harness.sessionStorage.setItem(
      OAUTH_RUNTIME_SESSION_STORAGE_KEY,
      JSON.stringify({
        hasOauthSession: true,
        accessToken: "opaque-session-123",
        expiresAt: Date.now() + 60_000,
        oauthClientId: "client_123",
      }),
    );

    harness.run(`
      accessToken = "opaque-session-123";
      tokenExpiresAt = Date.now() + 60_000;
      grantedOauthScopes = "scope-a";
      clearSessionAuthState();
    `);

    assert.equal(harness.localStorage.getItem(OAUTH_SESSION_STORAGE_KEY), null);
    assert.equal(
      harness.sessionStorage.getItem(OAUTH_RUNTIME_SESSION_STORAGE_KEY),
      null,
    );
    assert.equal(harness.run("accessToken"), null);
    assert.equal(harness.run("tokenExpiresAt"), null);
    assert.equal(harness.run("grantedOauthScopes"), "");
  });

  it("handles user sign-in as interactive when a silent refresh is pending", () => {
    const harness = createAuthHarness({ includeInteractive: true });
    harness.run(`
      oauthPendingOp = {
        kind: "silent-refresh",
        finish(ok) {
          globalThis.__silentRefreshFinished = ok;
          oauthPendingOp = null;
        },
      };
      tokenClient = {
        requestAccessToken(request) {
          globalThis.__tokenRequests.push(request);
        },
      };
      signIn();
    `);

    assert.equal(harness.context.__silentRefreshFinished, false);
    assert.equal(
      harness.run("oauthPendingOp && oauthPendingOp.kind"),
      "interactive",
    );
    assert.equal(harness.context.__tokenRequests.length, 1);

    harness.run(`
      handleTokenResponse({
        access_token: "opaque-session-123",
        expires_in: 3600,
        scope: GOOGLE_SIGNIN_SCOPES,
      });
    `);

    assert.equal(harness.run("accessToken"), "opaque-session-123");
    assert.equal(harness.run("oauthPendingOp"), null);
    assert.equal(harness.calls.revealSetupScreenAfterAuth, 1);
    assert.equal(harness.calls.loadAllData, 0);
  });
});
