import assert from "node:assert/strict";
import { test } from "node:test";
import vm from "node:vm";
import { makeFakeDocument, readRepoFile } from "./oneflow-l0-harness.mjs";

const ok = (body = {}) => ({ ok: true, status: 200, json: async () => body });

test("GFX-SOL-10 a failed header write retries the same created sheet after reload", async () => {
  const data = new Map();
  const sessionStorage = {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
  };
  let posts = 0;
  let puts = 0;
  const fetch = async (_url, init) => {
    if (init.method === "POST") {
      posts += 1;
      return ok({ spreadsheetId: "created-once", spreadsheetUrl: "https://docs.google.com/spreadsheets/d/created-once/edit" });
    }
    puts += 1;
    return puts === 1
      ? { ok: false, status: 503, json: async () => ({ error: { message: "try again" } }) }
      : ok();
  };
  function page() {
    const window = { location: { search: "" }, sessionStorage };
    const document = makeFakeDocument();
    document.documentElement = { classList: { contains: () => false, remove() {} } };
    const ctx = {
      window, document, fetch, sessionStorage, URLSearchParams,
      console: { log() {}, warn() {}, error() {} }, setTimeout, clearTimeout,
    };
    vm.createContext(ctx);
    vm.runInContext(readRepoFile("sheet-access-setup.js"), ctx, { filename: "sheet-access-setup.js" });
    const host = {
      getOAuthClientId: () => "client.apps.googleusercontent.com",
      getAccessToken: () => "fake-token",
      hasGrantedOauthScope: () => true,
      getGoogleSheetsScope: () => "https://www.googleapis.com/auth/spreadsheets",
      getStarterPipelineHeaders: () => ["Company", "Role"],
      getStarterPipelineHeaderRange: () => "Pipeline!A1:B1",
      refreshAccessTokenSilently: async () => false,
      showToast() {}, mergeStoredConfigOverridePatch() {},
      setInitialSheetAccessResolved() {}, setSheetId() {},
      getSheetId: () => "created-once",
    };
    window.JobBoredApp.core = {
      host,
      getGisLoaded: () => true,
      getTokenClient: () => ({}),
      getSHEET_ID: () => "",
      setSHEET_ID() {},
    };
    return window.JobBoredApp.setup;
  }
  const first = await page().handleSetupCreateStarterSheet({ context: "wizard" });
  assert.equal(first.ok, false);
  const retry = await page().handleSetupCreateStarterSheet({ context: "wizard" });
  assert.equal(retry.ok, true);
  assert.equal(retry.spreadsheetId, "created-once");
  assert.equal(posts, 1, "recovery writes headers on the same spreadsheet");
  assert.equal(puts, 2);
});
