import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function readRepo(rel) {
  return readFileSync(join(repoRoot, rel), "utf8");
}

// ============================================================
// T1 — user-content-store dismiss flag trios + gate read
// ============================================================

describe("enhancements wizard — store: dismiss flag trios + gate read", () => {
  function makeInMemoryDb() {
    const stores = {};
    function getStore(name) {
      if (!stores[name]) stores[name] = new Map();
      return stores[name];
    }
    function makeRequest(value) {
      const req = { result: value, onsuccess: null, onerror: null };
      Promise.resolve().then(() => { if (typeof req.onsuccess === "function") req.onsuccess(); });
      return req;
    }
    function makeWriteRequest() {
      const req = { onsuccess: null, onerror: null };
      Promise.resolve().then(() => { if (typeof req.onsuccess === "function") req.onsuccess(); });
      return req;
    }
    return {
      transaction(storeName) {
        const store = getStore(storeName);
        return {
          objectStore() {
            return {
              get(key) { return makeRequest(store.has(key) ? { key, value: store.get(key) } : undefined); },
              put(record) {
                store.set(record.key, record.value);
                return makeWriteRequest();
              },
            };
          },
        };
      },
    };
  }

  function loadStore() {
    const storeJs = readRepo("user-content-store.js");
    const fakeDb = makeInMemoryDb();
    const ctx = {
      window: {},
      indexedDB: {
        open() {
          const req = {
            onupgradeneeded: null, onsuccess: null, onerror: null,
            result: fakeDb,
          };
          Promise.resolve().then(() => { if (typeof req.onsuccess === "function") req.onsuccess({ target: req }); });
          return req;
        },
      },
      console,
      setTimeout,
      clearTimeout,
    };
    vm.createContext(ctx);
    vm.runInContext(storeJs, ctx, { filename: "user-content-store.js" });
    return ctx.window.CommandCenterUserContent;
  }

  it("exports getSerpApiEnhancementDismissed and setSerpApiEnhancementDismissed", async () => {
    const UC = loadStore();
    assert.equal(typeof UC.getSerpApiEnhancementDismissed, "function");
    assert.equal(typeof UC.setSerpApiEnhancementDismissed, "function");
    assert.equal(await UC.getSerpApiEnhancementDismissed(), false, "defaults to false");
    await UC.setSerpApiEnhancementDismissed(true);
    assert.equal(await UC.getSerpApiEnhancementDismissed(), true);
  });

  it("exports getGeminiEnhancementDismissed and setGeminiEnhancementDismissed", async () => {
    const UC = loadStore();
    assert.equal(typeof UC.getGeminiEnhancementDismissed, "function");
    assert.equal(typeof UC.setGeminiEnhancementDismissed, "function");
    assert.equal(await UC.getGeminiEnhancementDismissed(), false, "defaults to false");
    await UC.setGeminiEnhancementDismissed(true);
    assert.equal(await UC.getGeminiEnhancementDismissed(), true);
  });

  it("exports getAiProviderEnhancementDismissed and setAiProviderEnhancementDismissed", async () => {
    const UC = loadStore();
    assert.equal(typeof UC.getAiProviderEnhancementDismissed, "function");
    assert.equal(typeof UC.setAiProviderEnhancementDismissed, "function");
    assert.equal(await UC.getAiProviderEnhancementDismissed(), false, "defaults to false");
    await UC.setAiProviderEnhancementDismissed(true);
    assert.equal(await UC.getAiProviderEnhancementDismissed(), true);
  });

  it("exports isAllMandatorySetupComplete returning true only when infra+onboarding+discovery+goLive all set", async () => {
    const UC = loadStore();
    assert.equal(typeof UC.isAllMandatorySetupComplete, "function");
    assert.equal(await UC.isAllMandatorySetupComplete(), false, "false when nothing set");
    await UC.completeInfraSetup();
    await UC.completeOnboarding();
    await UC.completeDiscoverySetup();
    assert.equal(await UC.isAllMandatorySetupComplete(), false, "false until goLive also set");
    await UC.completeGoLiveSetup();
    assert.equal(await UC.isAllMandatorySetupComplete(), true);
  });
});
