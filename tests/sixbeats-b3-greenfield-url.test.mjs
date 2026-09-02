import assert from "node:assert/strict";
import { describe, it } from "node:test";
import vm from "node:vm";
import { readRepoFile } from "./oneflow-l0-harness.mjs";

/* ============================================================
   SIXBEATS claim C4 — `?greenfield=1` re-fired on every refresh.

   The param is a cold-start switch: it masks config.js, clears the
   localStorage breadcrumbs, and drops the IndexedDB user-content store.
   It is meant to run ONCE. As shipped it stayed in the address bar, so
   refreshing mid-setup wiped the flow state again and dropped the user
   back on cold start — spec §3.4 "Resume: reopening or refreshing lands
   on onboardingFlowState.beat with drafts restored" says the opposite.

   The fix is at the source: strip greenfield/fresh/reset from the URL
   with history.replaceState once the reset has been applied, leaving
   the persisted mask (the part that must survive a reload) untouched.
   ============================================================ */

const CONFIG_OVERRIDES_JS = readRepoFile("config-overrides.js");
const OVERRIDE_KEY = "command_center_config_overrides";

/**
 * A sandbox that mirrors the browser closely enough for the claim:
 * replaceState rewrites window.location the way a real one does, so a
 * second load of the module IS the refresh.
 */
function makeBrowser({ search }) {
  const storage = new Map();
  const session = new Map();
  const deletedDatabases = [];
  const replaceStateCalls = [];
  const win = {
    COMMAND_CENTER_CONFIG: { sheetId: "1BakedIntoConfigJs", oauthClientId: "baked.apps.googleusercontent.com" },
    location: {
      protocol: "http:",
      hostname: "localhost",
      port: "8080",
      origin: "http://localhost:8080",
      pathname: "/",
      search,
      hash: "#pipeline",
      get href() {
        return `http://localhost:8080${this.pathname}${this.search}${this.hash}`;
      },
    },
    history: {
      replaceState(state, title, url) {
        replaceStateCalls.push(String(url));
        const parsed = new URL(String(url), "http://localhost:8080");
        win.location.pathname = parsed.pathname;
        win.location.search = parsed.search;
        win.location.hash = parsed.hash;
      },
    },
    indexedDB: {
      deleteDatabase(name) {
        deletedDatabases.push(name);
        return { onsuccess: null, onerror: null, onblocked: null };
      },
    },
  };
  const ctx = {
    window: win,
    localStorage: {
      getItem: (k) => (storage.has(k) ? storage.get(k) : null),
      setItem: (k, v) => storage.set(k, String(v)),
      removeItem: (k) => storage.delete(k),
    },
    sessionStorage: {
      getItem: (k) => (session.has(k) ? session.get(k) : null),
      setItem: (k, v) => session.set(k, String(v)),
      removeItem: (k) => session.delete(k),
    },
    indexedDB: win.indexedDB,
    console: { warn() {}, error() {}, log() {} },
    fetch: async () => ({ ok: false, json: async () => ({}) }),
    URL,
    URLSearchParams,
    JSON,
    Object,
    Array,
    String,
    Number,
    Boolean,
    Date,
    Promise,
    Math,
    Error,
    setTimeout,
    clearTimeout,
  };
  vm.createContext(ctx);
  return {
    ctx,
    window: win,
    storage,
    deletedDatabases,
    replaceStateCalls,
    /** One page load of config-overrides.js. Call twice to model a refresh. */
    load() {
      vm.runInContext(CONFIG_OVERRIDES_JS, ctx, { filename: "config-overrides.js" });
    },
  };
}

describe("C4 · greenfield reset runs once, not on every refresh (spec §3.4)", () => {
  it("strips greenfield from the URL after applying the reset, keeping the rest of the address", () => {
    const browser = makeBrowser({ search: "?greenfield=1&job=abc" });
    browser.load();
    assert.equal(
      browser.window.location.search,
      "?job=abc",
      "the cold-start switch is spent once applied; unrelated params survive",
    );
    assert.equal(browser.window.location.pathname, "/");
    assert.equal(browser.window.location.hash, "#pipeline");
    assert.equal(browser.replaceStateCalls.length, 1, "one replaceState, not a navigation");
  });

  it("leaves no query string at all when greenfield was the only param", () => {
    const browser = makeBrowser({ search: "?greenfield=1" });
    browser.load();
    assert.equal(browser.window.location.search, "");
  });

  it("strips the fresh and reset aliases too", () => {
    for (const param of ["fresh", "reset"]) {
      const browser = makeBrowser({ search: `?${param}=1` });
      browser.load();
      assert.equal(
        browser.window.location.search,
        "",
        `?${param}=1 is an alias of ?greenfield=1 and has to be spent the same way`,
      );
    }
  });

  it("does not re-reset on the next load — the refresh resumes instead of wiping", () => {
    const browser = makeBrowser({ search: "?greenfield=1" });
    browser.load();
    assert.equal(browser.deletedDatabases.length, 1, "the first load is the reset");
    browser.load();
    assert.deepEqual(
      browser.deletedDatabases,
      ["command-center-user-content"],
      "a refresh must not drop the user-content store a second time — that is what lost the saved beat",
    );
  });

  it("keeps the persisted mask behavior exactly as it was", () => {
    const browser = makeBrowser({ search: "?greenfield=1" });
    browser.load();
    const mask = JSON.parse(browser.storage.get(OVERRIDE_KEY));
    assert.equal(mask.sheetId, "", "the mask is what keeps the reload cold-start");
    assert.equal(mask.oauthClientId, "");
    assert.equal(
      browser.storage.get("command_center_force_consent_prompt"),
      "1",
      "the forced consent prompt is part of the unchanged reset",
    );
  });

  it("touches neither the URL nor the stores when the param is absent", () => {
    const browser = makeBrowser({ search: "?job=abc" });
    browser.load();
    assert.equal(browser.replaceStateCalls.length, 0);
    assert.equal(browser.deletedDatabases.length, 0);
    assert.equal(browser.storage.has(OVERRIDE_KEY), false);
  });
});
