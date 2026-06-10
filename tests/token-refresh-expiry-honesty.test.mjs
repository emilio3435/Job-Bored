import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const authSessionJs = readFileSync(join(repoRoot, "auth-session.js"), "utf8");
const AUTH_SECTION_START = authSessionJs.indexOf("let accessToken = null;");
const AUTH_SECTION_END = authSessionJs.indexOf(
  "// ============================================\n// TOAST SYSTEM",
);

if (AUTH_SECTION_START === -1 || AUTH_SECTION_END === -1) {
  throw new Error(
    "Could not isolate the auth session section from auth-session.js",
  );
}

const authSectionSource = authSessionJs.slice(
  AUTH_SECTION_START,
  AUTH_SECTION_END,
);

/** VM preamble: host()/sheetId() helpers the extracted module expects at runtime. */
const authVmPreamble = `
function sheetId() {
  return "";
}
function host() {
  return {
    getOAuthClientId() { return "client_123"; },
    getSHEET_ID: () => "",
    getSheetId: () => "",
    setPendingSetupStarterSheetCreate() {},
    getPendingSetupStarterSheetCreate() { return false; },
    loadAllData() {},
    revealDashboardShell() {},
    revealSetupScreenAfterAuth() {},
    showSheetAccessGate,
    showToast,
    maybeSyncSettingsModalModeAfterAuth() {},
    renderSetupStarterSheetUi() {},
    renderAppsScriptDeployUi() {},
    recordSheetAccessError() {},
    escapeHtml(value) { return String(value); },
  };
}
`;

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

/**
 * WHY these tests exist: scheduleTokenRefresh used to stop the refresh
 * chain permanently on a single failed silent refresh (`if (ok)
 * scheduleTokenRefresh();`) — no retry, no toast, no gate. The most common
 * trigger is a laptop waking before its network: the session dies invisibly
 * behind a signed-in avatar and the user only learns on their next write.
 * These tests pin the honest chain: retry once after ~30s, then a final
 * check at the token's actual expiry that clears auth state, toasts
 * "Session expired", and opens the sign-in gate.
 */
function createRefreshHarness() {
  const calls = {
    updateAuthUI: 0,
    showSheetAccessGate: [],
    showToast: [],
  };
  const timers = [];
  const visibilityListeners = [];
  const fakeDocument = {
    visibilityState: "visible",
    addEventListener(type, fn) {
      visibilityListeners.push({ type, fn });
    },
  };
  const context = vm.createContext({
    console,
    localStorage: createStorage(),
    sessionStorage: createStorage(),
    document: fakeDocument,
    setTimeout(callback, delay, ...args) {
      const timer = { callback, delay, args, cleared: false, fired: false };
      timers.push(timer);
      return timer;
    },
    clearTimeout(timer) {
      if (timer && typeof timer === "object") timer.cleared = true;
    },
    fetch: async () => ({ ok: false, status: 403 }),
    __tokenRequests: [],
    updateAuthUI() {
      calls.updateAuthUI += 1;
    },
    fetchUserEmail() {},
    showSheetAccessGate(mode) {
      calls.showSheetAccessGate.push(mode);
    },
    showToast(message, type, persistent) {
      calls.showToast.push({ message, type, persistent });
    },
  });

  vm.runInContext(authVmPreamble + authSectionSource, context, {
    filename: "auth-session.js#token-refresh-honesty",
  });

  return {
    calls,
    context,
    visibilityListeners,
    armed() {
      return timers.filter((t) => !t.cleared && !t.fired);
    },
    async fire(timer) {
      timer.fired = true;
      await timer.callback(...timer.args);
      // Let chained promise callbacks (refreshAccessTokenSilently resolution
      // handlers) settle before the test asserts.
      await new Promise((resolve) => setImmediate(resolve));
    },
    run(source) {
      return vm.runInContext(source, context);
    },
  };
}

const FAILING_TOKEN_CLIENT = `
  tokenClient = {
    requestAccessToken() {
      globalThis.__tokenRequests.push("fail");
      throw new Error("network down");
    },
  };
`;

const SUCCEEDING_TOKEN_CLIENT = `
  tokenClient = {
    requestAccessToken(request) {
      globalThis.__tokenRequests.push(request || "ok");
      oauthPendingOp.finish(true);
    },
  };
`;

describe("token refresh chain honesty", () => {
  it("retries ~30s after a failed refresh, then arms a final check at expiry", async () => {
    const harness = createRefreshHarness();
    harness.run(`
      accessToken = "tok";
      tokenExpiresAt = Date.now() + 3600_000;
      ${FAILING_TOKEN_CLIENT}
      scheduleTokenRefresh();
    `);

    let armed = harness.armed();
    assert.equal(armed.length, 1);
    // ~5 minutes before expiry
    assert.ok(armed[0].delay > 3000_000 && armed[0].delay <= 3300_000);

    await harness.fire(armed[0]);
    armed = harness.armed();
    assert.equal(armed.length, 1, "a retry timer must be armed after failure");
    assert.equal(armed[0].delay, 30_000);

    await harness.fire(armed[0]);
    armed = harness.armed();
    assert.equal(
      armed.length,
      1,
      "a final expiry check must be armed after the retry fails",
    );
    // Final check fires at the token's actual expiry.
    assert.ok(armed[0].delay > 3300_000 && armed[0].delay <= 3600_000);
    // Still no scary UI before expiry — the session may yet recover.
    assert.deepEqual(harness.calls.showToast, []);
    assert.deepEqual(harness.calls.showSheetAccessGate, []);
  });

  it("clears auth state, toasts, and gates when the session is still dead at expiry", async () => {
    const harness = createRefreshHarness();
    harness.run(`
      accessToken = "tok";
      tokenExpiresAt = Date.now() + 3600_000;
      ${FAILING_TOKEN_CLIENT}
      scheduleTokenRefresh();
    `);

    await harness.fire(harness.armed()[0]); // proactive refresh fails
    await harness.fire(harness.armed()[0]); // retry fails
    await harness.fire(harness.armed()[0]); // final check at expiry fails

    assert.equal(harness.run("accessToken"), null);
    assert.equal(harness.run("tokenExpiresAt"), null);
    assert.deepEqual(harness.calls.showToast, [
      {
        message: "Session expired — please sign in again",
        type: "error",
        persistent: true,
      },
    ]);
    assert.deepEqual(harness.calls.showSheetAccessGate, ["signin"]);
  });

  it("resumes the normal chain when the retry succeeds (laptop-wake recovery)", async () => {
    const harness = createRefreshHarness();
    harness.run(`
      accessToken = "tok";
      tokenExpiresAt = Date.now() + 3600_000;
      ${FAILING_TOKEN_CLIENT}
      scheduleTokenRefresh();
    `);

    await harness.fire(harness.armed()[0]); // proactive refresh fails
    harness.run(SUCCEEDING_TOKEN_CLIENT); // network is back
    await harness.fire(harness.armed()[0]); // retry succeeds

    const armed = harness.armed();
    assert.equal(armed.length, 1, "the normal refresh chain must re-arm");
    assert.ok(armed[0].delay >= 10_000);
    assert.equal(harness.run("accessToken"), "tok");
    assert.deepEqual(harness.calls.showToast, []);
    assert.deepEqual(harness.calls.showSheetAccessGate, []);
  });

  it("recovers via the final expiry check when the network returns late", async () => {
    const harness = createRefreshHarness();
    harness.run(`
      accessToken = "tok";
      tokenExpiresAt = Date.now() + 3600_000;
      ${FAILING_TOKEN_CLIENT}
      scheduleTokenRefresh();
    `);

    await harness.fire(harness.armed()[0]); // proactive refresh fails
    await harness.fire(harness.armed()[0]); // retry fails
    harness.run(SUCCEEDING_TOKEN_CLIENT); // network back just before expiry
    await harness.fire(harness.armed()[0]); // final check succeeds

    assert.equal(harness.run("accessToken"), "tok");
    assert.deepEqual(harness.calls.showToast, []);
    assert.deepEqual(harness.calls.showSheetAccessGate, []);
    assert.equal(
      harness.armed().length,
      1,
      "the normal refresh chain must re-arm",
    );
  });
});

describe("visibilitychange proactive refresh", () => {
  it("registers a visibilitychange listener that refreshes when expiry is near", async () => {
    const harness = createRefreshHarness();
    harness.run(`
      accessToken = "tok";
      tokenExpiresAt = Date.now() + 120_000;
      ${SUCCEEDING_TOKEN_CLIENT}
      initTokenRefreshVisibilityListener();
    `);

    assert.equal(harness.visibilityListeners.length, 1);
    assert.equal(harness.visibilityListeners[0].type, "visibilitychange");

    harness.visibilityListeners[0].fn();
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(harness.context.__tokenRequests.length, 1);
    assert.equal(harness.context.__tokenRequests[0].prompt, "none");
    assert.equal(
      harness.armed().length,
      1,
      "a successful wake refresh must re-arm the chain",
    );
  });

  it("does nothing when the token is not close to expiry", async () => {
    const harness = createRefreshHarness();
    harness.run(`
      accessToken = "tok";
      tokenExpiresAt = Date.now() + 1800_000;
      ${SUCCEEDING_TOKEN_CLIENT}
      initTokenRefreshVisibilityListener();
    `);

    harness.visibilityListeners[0].fn();
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(harness.context.__tokenRequests.length, 0);
  });

  it("does nothing when the tab is hidden or the user is signed out", async () => {
    const harness = createRefreshHarness();
    harness.run(`
      accessToken = null;
      tokenExpiresAt = Date.now() + 60_000;
      ${SUCCEEDING_TOKEN_CLIENT}
      initTokenRefreshVisibilityListener();
    `);

    harness.visibilityListeners[0].fn();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(harness.context.__tokenRequests.length, 0);
  });
});
