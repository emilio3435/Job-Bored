import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

/* ============================================================
   RESJ K1 (browser half): every save of the primary resume also
   PUTs it to the server's canonical resume.txt, and the caller
   learns whether that copy was saved so the UI never shows a
   browser-only save as done. Fictional text only.
   ============================================================ */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const storeJs = readFileSync(join(repoRoot, "user-content-store.js"), "utf8");
const profileMaterialsJs = readFileSync(join(repoRoot, "profile-materials.js"), "utf8");
const materialsFeatureJs = readFileSync(join(repoRoot, "materials-feature.js"), "utf8");
const settingsProfileTabJs = readFileSync(join(repoRoot, "settings-profile-tab.js"), "utf8");

const CLEAN = "Jordan Rivera\nGrowth Marketing Leader\nAustin, TX | jordan.rivera@example.com\n";

/** An IndexedDB that always succeeds: enough for setPrimaryResume. */
function fakeIndexedDb() {
  const stores = new Map();
  const storeOf = (name) => {
    if (!stores.has(name)) stores.set(name, new Map());
    return stores.get(name);
  };
  const db = {
    objectStoreNames: { contains: () => true },
    close() {},
    transaction(name) {
      const data = storeOf(name);
      const tx = {
        oncomplete: null,
        onabort: null,
        onerror: null,
        objectStore() {
          const req = (fn) => {
            const r = { onsuccess: null, onerror: null, result: null };
            queueMicrotask(() => {
              r.result = fn();
              if (r.onsuccess) r.onsuccess();
            });
            return r;
          };
          return {
            clear: () => req(() => data.clear()),
            put: (rec) => req(() => data.set(rec.id != null ? rec.id : rec.key, rec)),
            get: (key) => req(() => data.get(key) || null),
            getAll: () => req(() => Array.from(data.values())),
            delete: (key) => req(() => data.delete(key)),
          };
        },
        abort() {},
      };
      setTimeout(() => tx.oncomplete && tx.oncomplete(), 0);
      return tx;
    },
  };
  return {
    stores,
    indexedDB: {
      open() {
        const r = { onsuccess: null, onerror: null, onupgradeneeded: null, result: db };
        queueMicrotask(() => r.onsuccess && r.onsuccess());
        return r;
      },
    },
  };
}

/**
 * @param {(url: string, init: RequestInit) => Promise<{ ok: boolean, status: number, json: () => Promise<unknown> }>} fetchImpl
 * @param {Record<string, string>} [config] window.COMMAND_CENTER_CONFIG
 * @param {typeof setTimeout} [clock] the store's setTimeout
 */
function loadStore(fetchImpl, config = {}, clock = setTimeout) {
  const calls = [];
  const idb = fakeIndexedDb();
  const window = { location: { protocol: "http:" }, COMMAND_CENTER_CONFIG: config };
  const ctx = {
    window,
    indexedDB: idb.indexedDB,
    crypto: { randomUUID: () => "uuid" },
    setTimeout: clock,
    clearTimeout,
    AbortController,
    queueMicrotask,
    Date,
    fetch: (url, init) => {
      calls.push({ url, init });
      return fetchImpl(url, init);
    },
  };
  vm.createContext(ctx);
  vm.runInContext(storeJs, ctx, { filename: "user-content-store.js" });
  return { UC: window.CommandCenterUserContent, calls, stores: idb.stores };
}

const answer = (status, body) => async () => ({ ok: status < 300, status, json: async () => body });

describe("setPrimaryResume copies the resume to the server (RESJ K1)", () => {
  it("should PUT the saved text to /profile/resume and report the server copy saved", async () => {
    const { UC, calls, stores } = loadStore(answer(200, { ok: true, chars: 60, savedAt: "2026-09-27T12:00:00.000Z" }));
    const record = await UC.setPrimaryResume({ source: "paste", extractedText: CLEAN });
    assert.equal(stores.get("resumeVersions").get("__primary__").extractedText, CLEAN.trim(), "browser copy saved");
    assert.equal((await record.serverSync).ok, true);
    assert.equal(calls.length, 1, "one server write per save");
    assert.equal(calls[0].url, "/profile/resume");
    assert.equal(calls[0].init.method, "PUT");
    assert.deepEqual(JSON.parse(calls[0].init.body), { resumeText: CLEAN.trim() });
    assert.equal(UC.describeResumeServerSync(await record.serverSync), "");
  });

  it("should use the configured API origin when the dashboard and API are split", async () => {
    const { UC, calls } = loadStore(answer(200, { ok: true }), { jobBoredApiUrl: "http://127.0.0.1:39999/" });
    await UC.setPrimaryResume({ source: "paste", extractedText: CLEAN });
    assert.equal(calls[0].url, "http://127.0.0.1:39999/profile/resume");
  });

  it("should never hold up the browser save while the server hangs", async () => {
    const { UC, stores } = loadStore(() => new Promise(() => {}));
    const record = await UC.setPrimaryResume({ source: "paste", extractedText: CLEAN });
    assert.equal(stores.get("resumeVersions").get("__primary__").extractedText, CLEAN.trim());
    assert.equal(typeof record.serverSync.then, "function", "the server result arrives later");
  });

  it("should give up on a server that never answers, even when the transport ignores the abort", async () => {
    /* The copy's 8 s timeout, compressed to a few milliseconds. */
    const fast = (fn, ms) => setTimeout(fn, ms >= 8000 ? 5 : ms);
    const { UC } = loadStore(() => new Promise(() => {}), {}, fast);
    const record = await UC.setPrimaryResume({ source: "paste", extractedText: CLEAN });
    const sync = await record.serverSync;
    assert.equal(sync.ok, false);
    assert.equal(sync.reason, "offline");
  });

  it("should keep the browser copy and say so plainly when the server can't be reached", async () => {
    const { UC, stores } = loadStore(async () => {
      throw new TypeError("Failed to fetch");
    });
    const record = await UC.setPrimaryResume({ source: "paste", extractedText: CLEAN });
    assert.equal(stores.get("resumeVersions").get("__primary__").extractedText, CLEAN.trim());
    assert.equal((await record.serverSync).ok, false);
    assert.equal((await record.serverSync).reason, "offline");
    assert.match(UC.describeResumeServerSync(await record.serverSync), /^Saved in this browser only\..*didn't get a copy/);
  });

  it("should say the server kept the previous resume when it refuses garbled text", async () => {
    const { UC } = loadStore(answer(422, { ok: false, reason: "resume_garbled", message: "garbled" }));
    const record = await UC.setPrimaryResume({ source: "paste", extractedText: CLEAN });
    assert.equal((await record.serverSync).reason, "garbled");
    assert.match(UC.describeResumeServerSync(await record.serverSync), /kept your previous resume/);
  });

  it("should treat a page with no JobBored API (hosted, static) as not saved on the server", async () => {
    const { UC } = loadStore(async () => ({ ok: false, status: 404, json: async () => { throw new SyntaxError("html"); } }));
    const record = await UC.setPrimaryResume({ source: "paste", extractedText: CLEAN });
    assert.equal((await record.serverSync).reason, "unavailable");
    assert.notEqual(UC.describeResumeServerSync(await record.serverSync), "");
  });
});

describe("resume upload surfaces show the server status (RESJ K1)", () => {
  for (const [name, src] of [
    ["profile-materials.js (Portfolio upload)", profileMaterialsJs],
    ["materials-feature.js (Portfolio paste)", materialsFeatureJs],
    ["settings-profile-tab.js (Settings upload)", settingsProfileTabJs],
  ]) {
    it(`${name} should read serverSync through describeResumeServerSync`, () => {
      assert.match(src, /await \w+\.serverSync/, "awaits the server copy's result");
      assert.match(src, /describeResumeServerSync\(sync\)/, "and shows its line");
    });
  }
});
