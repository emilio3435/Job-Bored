import assert from "node:assert/strict";
import { describe, it } from "node:test";
import vm from "node:vm";
import { readRepoFile } from "./oneflow-l0-harness.mjs";

/* ============================================================
   GFX BE-CORE · R10 — auth-session.js
     G6     the "not ready" toast names the one fix: reload, press again
     B1-N7  a GIS re-init resets granted scopes to "" (the type every
            reader normalizes), never []
     B1-N3  isGoogleSignInReady() lets B1 name an ad-blocker at once
            instead of waiting out a 120 s timer
     D8/R10 a desktop-managed keep-alive ({ ok:true, managedBy:"desktop" })
            does NOT set jb:install-keep-alive:installedAt; it records
            managedBy so the pill can say "Managed by JobBored app"
   ============================================================ */

const INSTALLED_KEY = "jb:install-keep-alive:installedAt";
const MANAGED_BY_KEY = "jb:install-keep-alive:managedBy";

function storage() {
  const map = new Map();
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

function makePill() {
  const classes = new Set();
  return {
    hidden: true,
    textContent: "",
    classList: {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      contains: (c) => classes.has(c),
    },
  };
}

function load({ fetchImpl, withGoogle = false } = {}) {
  const announced = [];
  const fetchCalls = [];
  const localStorage = storage();
  const pill = makePill();
  const window = {
    JobBoredA11y: { live: { announce: (m) => announced.push(String(m)) } },
    JobBoredApp: {
      configOverrides: { isLocalDashboardOrigin: () => true },
      core: {
        host: {
          getOAuthClientId: () => "client.apps.googleusercontent.com",
          escapeHtml: (v) => String(v),
          recordSheetAccessError() {},
          renderAppsScriptDeployUi() {},
          maybeSyncSettingsModalModeAfterAuth() {},
          showSheetAccessGate() {},
        },
      },
    },
    location: { origin: "http://localhost:8080", href: "http://localhost:8080/" },
  };
  const document = {
    addEventListener() {},
    getElementById: (id) => (id === "keepAlivePill" ? pill : null),
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  const ctx = {
    window,
    document,
    console: { warn() {}, error() {}, log() {}, info() {} },
    localStorage,
    sessionStorage: storage(),
    setTimeout,
    clearTimeout,
    fetch: async (url, init) => {
      fetchCalls.push({ url, init });
      return fetchImpl(url, init);
    },
  };
  if (withGoogle) {
    ctx.google = {
      accounts: { oauth2: { initTokenClient: () => ({ requestAccessToken() {} }) } },
    };
  }
  vm.createContext(ctx);
  vm.runInContext(readRepoFile("auth-session.js"), ctx, { filename: "auth-session.js" });
  return { auth: window.JobBoredApp.auth, window, announced, fetchCalls, localStorage, pill };
}

const jsonReply = (body, status = 200) => async () => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

describe("R10 · Google sign-in readiness", () => {
  it("G6 signIn before GIS is ready says: reload the page and press Continue with Google again", () => {
    const env = load({ fetchImpl: jsonReply({}) });
    env.auth.signIn();
    assert.deepEqual(env.announced, [
      "Google sign-in isn't ready yet. Reload the page and press Continue with Google again.",
    ]);
  });

  it("B1-N3 isGoogleSignInReady() is false with no token client and true once one exists", () => {
    const env = load({ fetchImpl: jsonReply({}) });
    assert.equal(typeof env.auth.isGoogleSignInReady, "function");
    assert.equal(env.auth.isGoogleSignInReady(), false);
    env.auth.setTokenClient({ requestAccessToken() {} });
    assert.equal(env.auth.isGoogleSignInReady(), true);
  });

  it("B1-N7 re-initializing GIS for a new client resets granted scopes to an empty string", () => {
    const env = load({ fetchImpl: jsonReply({}), withGoogle: true });
    env.auth.setGisLoaded(true);
    env.auth.setGrantedOauthScopes("https://www.googleapis.com/auth/spreadsheets");
    assert.equal(env.auth.applyOAuthClientChange("new.apps.googleusercontent.com"), true);
    assert.equal(env.auth.getGrantedOauthScopes(), "");
  });
});

describe("R10 · installKeepAliveOnce keys off managedBy", () => {
  it("R10 a desktop-managed answer does NOT set installedAt and records managedBy", async () => {
    const env = load({ fetchImpl: jsonReply({ ok: true, managedBy: "desktop" }) });
    await env.auth.installKeepAliveOnce();
    assert.equal(env.localStorage.getItem(INSTALLED_KEY), null, "a no-op must not read as installed");
    assert.equal(env.localStorage.getItem(MANAGED_BY_KEY), "desktop");
    assert.equal(env.window.keepAliveStatusState.managedBy, "desktop");
    assert.equal(env.window.keepAliveStatusState.installed, false);
  });

  it("R10 a desktop-managed answer is asked again next time, so a later source run can still install", async () => {
    const env = load({ fetchImpl: jsonReply({ ok: true, managedBy: "desktop" }) });
    await env.auth.installKeepAliveOnce();
    await env.auth.installKeepAliveOnce();
    assert.equal(env.fetchCalls.length, 2);
  });

  it("R10 a real install sets installedAt, clears any managedBy, and is not repeated", async () => {
    const env = load({
      fetchImpl: jsonReply({ ok: true, installedAt: "2026-09-26T13:00:00.000Z", jobLabel: "x" }),
    });
    env.localStorage.setItem(MANAGED_BY_KEY, "desktop");
    await env.auth.installKeepAliveOnce();
    assert.equal(env.localStorage.getItem(INSTALLED_KEY), "2026-09-26T13:00:00.000Z");
    assert.equal(env.localStorage.getItem(MANAGED_BY_KEY), null);
    assert.equal(env.window.keepAliveStatusState.installed, true);
    await env.auth.installKeepAliveOnce();
    assert.equal(env.fetchCalls.length, 1, "installed once, never re-POSTed");
  });

  it("R10 the pill says 'Managed by JobBored app' when the status names the desktop app", async () => {
    const env = load({ fetchImpl: jsonReply({ installed: false, managedBy: "desktop" }) });
    await env.auth.refreshKeepAlivePill();
    assert.equal(env.pill.hidden, false);
    assert.equal(env.pill.textContent, "Managed by JobBored app");
  });

  it("R10 the pill trusts the recorded managedBy when the status endpoint predates it", async () => {
    const env = load({ fetchImpl: jsonReply({ installed: false }) });
    env.localStorage.setItem(MANAGED_BY_KEY, "desktop");
    await env.auth.refreshKeepAlivePill();
    assert.equal(env.pill.textContent, "Managed by JobBored app");
  });

  it("R10 without managedBy the pill keeps its install states", async () => {
    const env = load({ fetchImpl: jsonReply({ installed: false }) });
    await env.auth.refreshKeepAlivePill();
    assert.equal(env.pill.textContent, "Not installed — install");
  });
});
