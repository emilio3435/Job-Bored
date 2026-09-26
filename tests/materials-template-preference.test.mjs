/**
 * Slice 3b: the materialsTemplate preference (user-content-store.js), its
 * select in the Profile & Materials modal, and the request payload.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { DEFAULT_FAMILY, listFamilies } from "../server/materials-templates.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

/** A minimal IndexedDB: one database, key-value object stores, async callbacks. */
function fakeIndexedDb(seed = {}) {
  const stores = new Map([["settings", new Map(Object.entries(seed).map(([k, v]) => [k, { key: k, value: v }]))]]);
  /** @param {() => unknown} fn */
  const request = (fn) => {
    const req = { result: undefined, error: null, onsuccess: null, onerror: null };
    setTimeout(() => {
      req.result = fn();
      if (req.onsuccess) req.onsuccess();
    }, 0);
    return req;
  };
  const db = {
    objectStoreNames: { contains: (name) => stores.has(name) },
    createObjectStore: (name) => {
      stores.set(name, new Map());
      return { indexNames: { contains: () => true }, createIndex() {} };
    },
    onversionchange: null,
    close() {},
    transaction: (name) => ({
      objectStore: () => {
        if (!stores.has(name)) stores.set(name, new Map());
        const store = stores.get(name);
        return {
          get: (key) => request(() => store.get(key)),
          put: (record) => request(() => {
            store.set(record.key, record);
            return record.key;
          }),
        };
      },
    }),
  };
  return {
    stores,
    open: () => request(() => db),
  };
}

/** @param {Record<string, unknown>} [seed] */
function loadStore(seed) {
  const idb = fakeIndexedDb(seed);
  /** @type {Record<string, any>} */
  const sandbox = { window: {}, console, setTimeout, clearTimeout, indexedDB: idb };
  vm.createContext(sandbox);
  vm.runInContext(readFileSync(join(repoRoot, "user-content-store.js"), "utf8"), sandbox);
  return { UC: sandbox.window.CommandCenterUserContent, idb };
}

describe("materialsTemplate preference", () => {
  it("should default to signal", async () => {
    const { UC } = loadStore();
    assert.equal(UC.DEFAULT_PREFERENCES.materialsTemplate, "signal");
    const prefs = await UC.getPreferences();
    assert.equal(prefs.materialsTemplate, "signal");
  });

  it("should normalize an unknown stored id back to the default on read", async () => {
    const { UC } = loadStore({ preferences: { materialsTemplate: "volt", tone: "warm" } });
    const prefs = await UC.getPreferences();
    assert.equal(prefs.materialsTemplate, "signal");
  });

  it("should save a registry family and refuse an unknown one", async () => {
    const { UC, idb } = loadStore();
    await UC.savePreferences({ materialsTemplate: "dossier" });
    assert.equal((await UC.getPreferences()).materialsTemplate, "dossier");
    assert.equal(idb.stores.get("settings").get("preferences").value.materialsTemplate, "dossier");
    await UC.savePreferences({ materialsTemplate: "not-a-family" });
    assert.equal((await UC.getPreferences()).materialsTemplate, "signal");
    await UC.savePreferences({ tone: "direct" });
    assert.equal((await UC.getPreferences()).materialsTemplate, "signal", "saving other fields keeps the family");
  });
});

describe("the Template select and the request payload", () => {
  const partial = readFileSync(join(repoRoot, "partials/profile-materials-modal.html"), "utf8");
  const profileMaterials = readFileSync(join(repoRoot, "profile-materials.js"), "utf8");
  const materialsFeature = readFileSync(join(repoRoot, "materials-feature.js"), "utf8");
  const roleMaterials = readFileSync(join(repoRoot, "role-materials.js"), "utf8");

  it("should sit beside the other template selects in Profile & Materials", () => {
    const templatesGroup = partial.slice(partial.indexOf("Templates &amp; appearance"), partial.indexOf("Voice &amp; targeting"));
    assert.match(templatesGroup, /<label[\s\S]*?for="prefMaterialsTemplate"[\s\S]*?>Template<\/label/);
    assert.match(templatesGroup, /<select[\s\S]*?id="prefMaterialsTemplate"/);
    assert.match(templatesGroup, /aria-describedby="prefMaterialsTemplateHint"/);
  });

  it("should be filled from the registry list and saved with the other preferences", () => {
    assert.match(profileMaterials, /fillMaterialsTemplateSelect\("prefMaterialsTemplate", prefs\.materialsTemplate\)/);
    assert.match(profileMaterials, /MATERIALS_TEMPLATE_FAMILIES/);
    assert.match(materialsFeature, /getElementById\("prefMaterialsTemplate"\)/);
    assert.match(materialsFeature, /materialsTemplate:\s*\n?\s*\(materialsTemplateEl && materialsTemplateEl\.value\)/);
  });

  it("should send the saved family as preferredTemplate on every draft request", () => {
    assert.match(roleMaterials, /function withTemplatePreference\(body\)/);
    assert.match(roleMaterials, /body\.preferredTemplate = id/);
    const requestPosts = roleMaterials.match(/withTemplatePreference\(body\)\.then/g) || [];
    assert.equal(requestPosts.length, 2, "manual and auto drafts both carry the preference");
  });

  it("should offer Regenerate in… for the other families on a published package", () => {
    assert.match(roleMaterials, /data-action="materials-regenerate" data-template="/);
    assert.match(roleMaterials, /"\/regenerate", \{ template: template \}/);
    assert.match(roleMaterials, /templateBarHtml\(manifest\)/);
  });
});

describe("the browser's bundled family list", () => {
  it("should match the registry (id, label, description, default)", () => {
    const source = readFileSync(join(repoRoot, "user-content-store.js"), "utf8");
    /** @type {Record<string, any>} */
    const sandbox = { window: {}, console };
    vm.createContext(sandbox);
    vm.runInContext(source, sandbox);
    const bundled = sandbox.window.CommandCenterUserContent.MATERIALS_TEMPLATE_FAMILIES;
    assert.deepEqual(
      JSON.parse(JSON.stringify(bundled)),
      listFamilies().map(({ id, label, description, default: isDefault }) => ({ id, label, description, default: isDefault })),
    );
    assert.equal(sandbox.window.CommandCenterUserContent.DEFAULT_PREFERENCES.materialsTemplate, DEFAULT_FAMILY);
  });
});
