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

function createDocument(calls) {
  const refreshBtn = {
    classList: {
      add(value) {
        calls.refreshClassAdds.push(value);
      },
      remove(value) {
        calls.refreshClassRemoves.push(value);
      },
    },
  };
  return {
    getElementById(id) {
      if (id === "refreshBtn") return refreshBtn;
      return null;
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
          calls.scriptUrls.push(el._src);
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

function createHarness({ activeSheetId = null } = {}) {
  const calls = {
    appendedScripts: 0,
    fetchUrls: [],
    refreshClassAdds: [],
    refreshClassRemoves: [],
    scriptUrls: [],
    setDataLoadFailed: [],
    setDashboardDataHydrated: [],
    setPipelineData: [],
    setPipelineRawRows: [],
    showSheetAccessGate: [],
    revealSetupScreenAfterAuth: 0,
  };

  const host = {
    getOAuthClientId() {
      return "client-id";
    },
    getAccessToken() {
      return "access-token";
    },
    getActiveSheetId() {
      return activeSheetId;
    },
    getInitialSheetAccessResolved() {
      return false;
    },
    setPipelineRawRows(value) {
      calls.setPipelineRawRows.push(value);
    },
    setPipelineData(value) {
      calls.setPipelineData.push(value);
    },
    setDashboardDataHydrated(value) {
      calls.setDashboardDataHydrated.push(value);
    },
    setDataLoadFailed(value) {
      calls.setDataLoadFailed.push(value);
    },
    showSheetAccessGate(mode) {
      calls.showSheetAccessGate.push(mode);
    },
    revealSetupScreenAfterAuth() {
      calls.revealSetupScreenAfterAuth += 1;
    },
  };
  const windowEl = { JobBoredApp: { core: { host } } };
  const context = vm.createContext({
    console: { log() {}, warn() {}, error() {} },
    document: createDocument(calls),
    fetch: async (url) => {
      calls.fetchUrls.push(String(url));
      return {
        ok: false,
        status: 404,
        json: async () => ({}),
        text: async () => "",
      };
    },
    localStorage: createStorage(),
    setTimeout,
    clearTimeout,
    window: windowEl,
  });

  vm.runInContext(sheetsReadSource, context, {
    filename: "sheets-read-load.js",
  });

  return { calls, sheetsRead: windowEl.JobBoredApp.sheetsRead };
}

describe("sheets-read-load missing Sheet ID guard", () => {
  it("does not build Google Sheets URLs when signed in without an active Sheet ID", async () => {
    const { calls, sheetsRead } = createHarness({ activeSheetId: null });

    const ok = await sheetsRead.loadAllData();

    assert.equal(ok, false);
    assert.deepEqual(calls.fetchUrls, []);
    assert.equal(calls.appendedScripts, 0);
    assert.deepEqual(calls.scriptUrls, []);
    assert.deepEqual(calls.setPipelineRawRows, [null]);
    assert.equal(calls.setPipelineData.length, 1);
    assert.deepEqual(calls.setDashboardDataHydrated, [false]);
    assert.deepEqual(calls.setDataLoadFailed, [false]);
    assert.deepEqual(calls.showSheetAccessGate, []);
    assert.equal(calls.revealSetupScreenAfterAuth, 1);
  });
});
