import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const sheetsReadSource = readFileSync(
  join(repoRoot, "sheets-read-load.js"),
  "utf8",
);

/**
 * WHY these tests exist: a 401 on the Sheets API read with a failed silent
 * refresh used to `return null` and silently fall through to the
 * unauthenticated JSONP/CSV fallback. On a public sheet that renders a
 * zombie "signed-in" dashboard where reads work and every write fails; on a
 * private sheet the user gets a generic error panel while the real Sheets
 * API error (recorded via recordSheetAccessError) never renders. These
 * tests pin the write path's honesty for reads: clear auth state + toast +
 * route to the sign-in gate, and surface the recorded API error text.
 */
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

function createDocument(calls, elements) {
  return {
    getElementById(id) {
      return elements[id] || null;
    },
    createElement(tagName) {
      const el = {
        tagName,
        id: "",
        onerror: null,
        remove() {},
      };
      Object.defineProperty(el, "src", {
        get() {
          return el._src || "";
        },
        set(value) {
          el._src = String(value);
        },
      });
      return el;
    },
    head: {
      appendChild(el) {
        calls.appendedScripts += 1;
        if (typeof el.onerror === "function") el.onerror();
      },
    },
  };
}

function createHarness({
  initialAccessResolved = false,
  fetchImpl,
  refreshResult = false,
} = {}) {
  const calls = {
    appendedScripts: 0,
    fetchUrls: [],
    refreshAttempts: 0,
    clearSessionAuthState: 0,
    showToast: [],
    showSheetAccessGate: [],
    setDataLoadFailed: [],
    renderPipeline: 0,
  };
  const state = {
    accessToken: "access-token",
    lastSheetAccessError: "",
    initialAccessResolved,
  };

  const elements = {
    refreshBtn: {
      classList: { add() {}, remove() {} },
    },
    jobCards: { innerHTML: "stale cards" },
    errorState: { style: { display: "none" } },
    errorOpenDirect: { href: "" },
    errorViewSheet: { href: "" },
    errorStateHint: { textContent: "" },
  };

  const host = {
    getOAuthClientId: () => "client-id",
    getAccessToken: () => state.accessToken,
    getActiveSheetId: () => "1234567890abcdefghijklmnopqrstuvwxyzABCDEF12",
    getInitialSheetAccessResolved: () => state.initialAccessResolved,
    setInitialSheetAccessResolved(value) {
      state.initialAccessResolved = !!value;
    },
    async refreshAccessTokenSilently() {
      calls.refreshAttempts += 1;
      return refreshResult;
    },
    clearSessionAuthState() {
      calls.clearSessionAuthState += 1;
      state.accessToken = null;
    },
    showToast(message, type, persistent) {
      calls.showToast.push({ message, type, persistent });
    },
    showSheetAccessGate(mode) {
      calls.showSheetAccessGate.push(mode);
    },
    recordSheetAccessError(err) {
      state.lastSheetAccessError =
        err && err.message ? String(err.message) : String(err);
    },
    getLastSheetAccessError: () => state.lastSheetAccessError,
    setPipelineRawRows() {},
    setPipelineData() {},
    setDashboardDataHydrated() {},
    setDataLoadFailed(value) {
      calls.setDataLoadFailed.push(value);
    },
    applyEnrichmentCache() {},
    renderPipeline() {
      calls.renderPipeline += 1;
    },
    renderBrief() {},
    updateLastRefresh() {},
    maybeAutoOpenExpiredReviewModal() {},
    revealDashboardShell() {},
    revealSetupScreenAfterAuth() {},
    runPostAccessBootstrapOnce() {},
  };

  const windowEl = {
    JobBoredApp: { core: { host } },
    location: { href: "http://dash.example/" },
  };
  const context = vm.createContext({
    console: { log() {}, warn() {}, error() {}, info() {} },
    document: createDocument(calls, elements),
    fetch: async (url) => {
      calls.fetchUrls.push(String(url));
      return fetchImpl(String(url));
    },
    localStorage: createStorage(),
    setTimeout,
    clearTimeout,
    window: windowEl,
  });

  vm.runInContext(sheetsReadSource, context, {
    filename: "sheets-read-load.js#session-expiry",
  });

  return { calls, state, elements, sheetsRead: windowEl.JobBoredApp.sheetsRead };
}

describe("read-path 401 after failed refresh", () => {
  it("clears auth state, toasts, and routes to the sign-in gate — no JSONP fallback", async () => {
    const { calls, state, sheetsRead } = createHarness({
      refreshResult: false,
      fetchImpl: () => ({
        ok: false,
        status: 401,
        json: async () => ({ error: { message: "Invalid Credentials" } }),
        text: async () => "",
      }),
    });

    const ok = await sheetsRead.loadAllData();

    assert.equal(ok, false);
    assert.equal(calls.refreshAttempts, 1);
    assert.equal(calls.clearSessionAuthState, 1);
    assert.deepEqual(calls.showToast, [
      {
        message: "Session expired — please sign in again",
        type: "error",
        persistent: true,
      },
    ]);
    assert.deepEqual(calls.showSheetAccessGate, ["signin"]);
    assert.equal(state.accessToken, null);
    // The zombie-dashboard bug: an unauthenticated JSONP <script> fallback
    // must never fire once the session is known dead.
    assert.equal(calls.appendedScripts, 0);
    assert.equal(
      calls.fetchUrls.filter((u) => u.includes("docs.google.com")).length,
      0,
    );
  });

  it("retries once via silent refresh and keeps the session when it succeeds", async () => {
    let sheetsApiCalls = 0;
    const { calls, sheetsRead } = createHarness({
      refreshResult: true,
      fetchImpl: (url) => {
        if (url.includes("sheets.googleapis.com")) {
          sheetsApiCalls += 1;
          if (sheetsApiCalls === 1) {
            return {
              ok: false,
              status: 401,
              json: async () => ({}),
              text: async () => "",
            };
          }
          return {
            ok: true,
            status: 200,
            json: async () => ({
              values: [
                ["Date", "Title", "Company"],
                ["2026-06-01", "Engineer", "Acme"],
              ],
            }),
            text: async () => "",
          };
        }
        return { ok: false, status: 404, json: async () => ({}), text: async () => "" };
      },
    });

    const ok = await sheetsRead.loadAllData();

    assert.equal(ok, true);
    assert.equal(calls.refreshAttempts, 1);
    assert.equal(calls.clearSessionAuthState, 0);
    assert.deepEqual(calls.showToast, []);
    assert.equal(sheetsApiCalls, 2);
  });
});

describe("read-path non-401 API errors mid-session", () => {
  it("renders the recorded Sheets API error in #errorStateHint instead of the static guess", async () => {
    const { calls, elements, sheetsRead } = createHarness({
      initialAccessResolved: true,
      fetchImpl: (url) => {
        if (url.includes("sheets.googleapis.com")) {
          return {
            ok: false,
            status: 403,
            json: async () => ({
              error: { message: "The caller does not have permission" },
            }),
            text: async () => "",
          };
        }
        // CSV fallback URLs also fail — private sheet.
        return { ok: false, status: 404, json: async () => ({}), text: async () => "" };
      },
    });

    const ok = await sheetsRead.loadAllData();

    assert.equal(ok, false);
    assert.equal(elements.errorState.style.display, "block");
    assert.equal(
      elements.errorStateHint.textContent,
      "The caller does not have permission",
    );
    // No session-expiry theatre for a permission problem.
    assert.equal(calls.clearSessionAuthState, 0);
    assert.deepEqual(calls.showSheetAccessGate, []);
  });
});
