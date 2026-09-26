import assert from "node:assert/strict";
import { describe, it } from "node:test";
import vm from "node:vm";
import { makeFakeDocument, readRepoFile } from "./oneflow-l0-harness.mjs";

/* ============================================================
   GFX BE-CORE · B1-N2 + G16 — the starter sheet is created once,
   answers with a typed result, and never opens a popup.

   B1-N2: a token without the Sheets scope used to call
   signIn({prompt:"consent"}) three awaits deep, outside any user
   gesture, so the popup was blocked and the flow died silently. It now
   returns { ok:false, reason:"scope_missing" }; B1 calls consent on the
   next click.
   G16: window.open after the awaits was popup-blocked too; onCreated
   carries spreadsheetUrl and FE-B1 renders the link. The pending-resume
   create and a second click must not make two sheets.
   ============================================================ */

const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const FAKE_TOKEN = "fake-access-token";

function deferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function load({ scopeGranted = true, createReply, headerReply } = {}) {
  const doc = makeFakeDocument();
  doc.documentElement = { classList: { contains: () => false, remove() {} } };
  const calls = [];
  const record = (name, ret) => (...args) => {
    calls.push({ name, args });
    return ret;
  };
  const fetchCalls = [];
  let sheetId = "";
  const win = {
    location: { search: "" },
    open: record("window.open", null),
  };
  const ctx = {
    window: win,
    document: doc,
    console: { warn() {}, error() {}, log() {}, info() {} },
    setTimeout,
    clearTimeout,
    URLSearchParams,
    fetch: async (url, init = {}) => {
      fetchCalls.push({ url, method: init.method || "GET" });
      if (init.method === "POST") {
        return typeof createReply === "function"
          ? createReply()
          : jsonResponse(200, {
              spreadsheetId: "sheet-123",
              spreadsheetUrl: "https://docs.google.com/spreadsheets/d/sheet-123/edit",
            });
      }
      return headerReply || jsonResponse(200, {});
    },
  };
  vm.createContext(ctx);
  vm.runInContext(readRepoFile("sheet-access-setup.js"), ctx, {
    filename: "sheet-access-setup.js",
  });
  win.JobBoredApp.core = {
    host: {
      getOAuthClientId: () => "client.apps.googleusercontent.com",
      getAccessToken: () => FAKE_TOKEN,
      hasGrantedOauthScope: (scope) => scope === SHEETS_SCOPE && scopeGranted,
      getGoogleSheetsScope: () => SHEETS_SCOPE,
      getStarterPipelineHeaders: () => ["Company", "Role"],
      getStarterPipelineHeaderRange: () => "Pipeline!A1:B1",
      refreshAccessTokenSilently: async () => false,
      clearSessionAuthState: record("clearSessionAuthState"),
      signIn: record("signIn"),
      showToast: record("showToast"),
      openCommandCenterSettingsModal: record("openCommandCenterSettingsModal"),
      mergeStoredConfigOverridePatch: record("mergeStoredConfigOverridePatch"),
      setInitialSheetAccessResolved: record("setInitialSheetAccessResolved"),
      runPostAccessBootstrapOnce: async () => {},
      loadAllData: async () => {},
      requestDiscoverySetup: async () => {},
      getSheetId: () => sheetId,
    },
    getGisLoaded: () => true,
    getTokenClient: () => ({}),
    getSHEET_ID: () => sheetId,
    setSHEET_ID: (v) => {
      sheetId = v;
    },
    setPendingSetupStarterSheetCreate: record("setPendingSetupStarterSheetCreate"),
  };
  return {
    setup: win.JobBoredApp.setup,
    calls,
    fetchCalls,
    named: (name) => calls.filter((c) => c.name === name),
    creates: () => fetchCalls.filter((c) => c.method === "POST"),
  };
}

// The module runs in its own vm realm; copy the plain result into this one.
const plain = (v) => JSON.parse(JSON.stringify(v ?? null));

describe("B1-N2 · a missing Sheets scope is a typed answer, not a blocked popup", () => {
  it("B1-N2 Google's 403 'insufficient authentication scopes' returns scope_missing and never calls signIn", async () => {
    const env = load({
      createReply: () =>
        jsonResponse(403, {
          error: { message: "Request had insufficient authentication scopes." },
        }),
    });
    const result = plain(await env.setup.handleSetupCreateStarterSheet({ context: "wizard" }));
    assert.deepEqual(
      { ok: result.ok, reason: result.reason },
      { ok: false, reason: "scope_missing" },
    );
    assert.deepEqual(env.named("signIn"), [], "consent outside a gesture is popup-blocked");
    assert.deepEqual(
      env.named("setPendingSetupStarterSheetCreate").filter((c) => c.args[0] === true),
      [],
      "no resume is queued when no sign-in was started",
    );
  });

  it("B1-N2 the post-sign-in resume without the scope returns scope_missing and never calls signIn", async () => {
    const env = load({ scopeGranted: false });
    const result = plain(await env.setup.handleSetupCreateStarterSheet());
    assert.equal(result.ok, false);
    assert.equal(result.reason, "scope_missing");
    assert.deepEqual(env.named("signIn"), []);
    assert.equal(env.creates().length, 0);
  });

  it("B1-N2 a click without the scope still opens consent synchronously, inside the gesture", () => {
    const env = load({ scopeGranted: false });
    void env.setup.handleSetupCreateStarterSheet({ context: "wizard" });
    // No await: the signIn must already have happened on the click's own tick.
    assert.equal(env.named("signIn").length, 1);
    assert.equal(env.named("signIn")[0].args[0].prompt, "consent");
  });

  it("B1-N2 a created sheet answers ok with its id and URL", async () => {
    const env = load();
    const result = plain(await env.setup.handleSetupCreateStarterSheet({ context: "wizard" }));
    assert.deepEqual(result, {
      ok: true,
      spreadsheetId: "sheet-123",
      spreadsheetUrl: "https://docs.google.com/spreadsheets/d/sheet-123/edit",
    });
  });
});

describe("G16 · exactly one sheet, no popup", () => {
  it("G16 the pending-resume create and a second click make ONE sheet", async () => {
    const gate = deferred();
    const env = load({
      createReply: async () => {
        await gate.promise;
        return jsonResponse(200, {
          spreadsheetId: "sheet-once",
          spreadsheetUrl: "https://docs.google.com/spreadsheets/d/sheet-once/edit",
        });
      },
    });
    const created = [];
    const opts = { context: "wizard", onCreated: (c) => created.push(c) };
    const resume = env.setup.handleSetupCreateStarterSheet();
    const click = env.setup.handleSetupCreateStarterSheet(opts);
    const click2 = env.setup.handleSetupCreateStarterSheet(opts);
    gate.resolve();
    const results = plain(await Promise.all([resume, click, click2]));
    assert.equal(env.creates().length, 1, "one POST to Google, however many callers");
    for (const r of results) {
      assert.equal(r.ok, true);
      assert.equal(r.spreadsheetId, "sheet-once");
    }
    assert.equal(created.length <= 1, true, "onCreated fires at most once");
  });

  it("G16 once the first create settles, a new explicit create is allowed again", async () => {
    const env = load({
      createReply: () => jsonResponse(500, { error: { message: "backend error" } }),
    });
    const first = plain(await env.setup.handleSetupCreateStarterSheet({ context: "wizard" }));
    assert.equal(first.ok, false);
    await env.setup.handleSetupCreateStarterSheet({ context: "wizard" });
    assert.equal(env.creates().length, 2, "a failed create must not wedge the guard");
  });

  it("G16 the wizard path never calls window.open and hands spreadsheetUrl to onCreated", async () => {
    const env = load();
    const created = [];
    await env.setup.handleSetupCreateStarterSheet({
      context: "wizard",
      onCreated: (c) => created.push(plain(c)),
    });
    assert.deepEqual(env.named("window.open"), []);
    assert.equal(created.length, 1);
    assert.equal(created[0].spreadsheetUrl, "https://docs.google.com/spreadsheets/d/sheet-123/edit");
  });

  it("G16 the dashboard path never calls window.open either", async () => {
    const env = load();
    await env.setup.handleSetupCreateStarterSheet({ context: "settings" });
    assert.deepEqual(env.named("window.open"), []);
  });

  it("G16 the source carries no window.open at all", () => {
    assert.doesNotMatch(readRepoFile("sheet-access-setup.js"), /window\.open\(/);
  });
});

describe("B1-N4 contract · verifyExistingSheetAccess reasons", () => {
  function verify(env, opts) {
    return env.setup.verifyExistingSheetAccess(opts).then(plain);
  }

  it("B1-N4 no token → no_token; metadata refused → access_denied; header row refused → headers_unreadable; both ok → headers_ok", async () => {
    const env = load();
    assert.equal((await verify(env, { sheetId: "s", accessToken: "" })).reason, "no_token");
    const denied = await verify(env, {
      sheetId: "s",
      accessToken: FAKE_TOKEN,
      fetchImpl: async () => ({ ok: false, status: 403 }),
    });
    assert.deepEqual(denied, { ok: false, reason: "access_denied", status: 403 });
    let n = 0;
    const headers = await verify(env, {
      sheetId: "s",
      accessToken: FAKE_TOKEN,
      fetchImpl: async () => (n++ === 0 ? { ok: true, status: 200 } : { ok: false, status: 400 }),
    });
    assert.deepEqual(headers, { ok: false, reason: "headers_unreadable", status: 400 });
    const ok = await verify(env, {
      sheetId: "s",
      accessToken: FAKE_TOKEN,
      fetchImpl: async () => ({ ok: true, status: 200 }),
    });
    assert.deepEqual(ok, { ok: true, reason: "headers_ok" });
  });
});
