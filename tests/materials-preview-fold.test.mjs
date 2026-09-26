/**
 * Slice 7 (lane T): the browser's five `visualThemeId` preview themes fold
 * into the #126 template registry. The BYOK preview renders the registry
 * family (`materialsTemplate`) with accent/density knobs, a stored
 * `visualThemeId` migrates one time, and no code path reads the retired key.
 */

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { familyIds } from "../server/materials-templates.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const readRoot = (name) => readFileSync(join(repoRoot, name), "utf8");

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
  vm.runInContext(readRoot("user-content-store.js"), sandbox);
  return { UC: sandbox.window.CommandCenterUserContent, idb };
}

/** @param {Record<string, any>} [userContent] */
function loadVisualThemes(userContent) {
  /** @type {Record<string, any>} */
  const sandbox = { window: {}, console };
  if (userContent) sandbox.window.CommandCenterUserContent = userContent;
  vm.createContext(sandbox);
  vm.runInContext(readRoot("visual-themes.js"), sandbox);
  return sandbox.window.CommandCenterVisualThemes;
}

describe("slice 7: visualThemeId is retired from preferences", () => {
  it("should default to the registry family with volt accent and standard density", async () => {
    const { UC } = loadStore();
    assert.ok(!("visualThemeId" in UC.DEFAULT_PREFERENCES), "the retired key leaves DEFAULT_PREFERENCES");
    assert.equal(UC.DEFAULT_PREFERENCES.materialsTemplate, "signal");
    assert.equal(UC.DEFAULT_PREFERENCES.materialsAccent, "volt");
    assert.equal(UC.DEFAULT_PREFERENCES.materialsDensity, "standard");
    assert.deepEqual(JSON.parse(JSON.stringify(UC.MATERIALS_ACCENTS)).map((a) => a.id), ["volt", "ink"]);
    assert.deepEqual(JSON.parse(JSON.stringify(UC.MATERIALS_DENSITIES)).map((d) => d.id), ["standard"]);
    const prefs = await UC.getPreferences();
    assert.ok(!("visualThemeId" in prefs), "reads never return the retired key");
    assert.equal(prefs.materialsTemplate, "signal");
    assert.equal(prefs.materialsAccent, "volt");
    assert.equal(prefs.materialsDensity, "standard");
  });

  it("should migrate a stored visualThemeId one time (serif goes editorial, muted/contrast go ink)", async () => {
    const cases = [
      ["classic", "signal", "volt"],
      ["compact", "signal", "volt"],
      ["serif_emphasis", "editorial", "volt"],
      ["muted", "signal", "ink"],
      ["high_contrast", "signal", "ink"],
      ["not-a-theme", "signal", "volt"],
    ];
    for (const [theme, family, accent] of cases) {
      const { UC } = loadStore({ preferences: { visualThemeId: theme, tone: "warm" } });
      const prefs = await UC.getPreferences();
      assert.equal(prefs.materialsTemplate, family, theme);
      assert.equal(prefs.materialsAccent, accent, theme);
      assert.equal(prefs.materialsDensity, "standard", theme);
      assert.ok(!("visualThemeId" in prefs), `${theme}: the retired key is not returned`);
    }
  });

  it("should never let the migration clobber an explicit template or accent choice", async () => {
    const { UC } = loadStore({
      preferences: { visualThemeId: "classic", materialsTemplate: "dossier", materialsAccent: "ink" },
    });
    const prefs = await UC.getPreferences();
    assert.equal(prefs.materialsTemplate, "dossier");
    assert.equal(prefs.materialsAccent, "ink");
    assert.ok(!("visualThemeId" in prefs));
  });

  it("should drop the retired key on write and normalize the knobs", async () => {
    const { UC, idb } = loadStore({ preferences: { visualThemeId: "muted", tone: "warm" } });
    await UC.savePreferences({ tone: "direct" });
    const stored = idb.stores.get("settings").get("preferences").value;
    assert.ok(!("visualThemeId" in stored), "the retired key is removed on write");
    assert.equal((await UC.getPreferences()).materialsAccent, "ink", "the migration survives the write");
    await UC.savePreferences({ materialsAccent: "ember" });
    assert.equal((await UC.getPreferences()).materialsAccent, "volt", "an unknown accent falls back to volt");
    await UC.savePreferences({ materialsAccent: "ink" });
    assert.equal((await UC.getPreferences()).materialsAccent, "ink");
    await UC.savePreferences({ materialsDensity: "tight" });
    assert.equal(
      (await UC.getPreferences()).materialsDensity,
      "standard",
      "only densities a family lists survive (standard today)",
    );
  });
});

describe("slice 7: visual-themes.js is a thin adapter over the registry list", () => {
  const families = [
    { id: "signal", label: "Signal", description: "The default.", default: true },
    { id: "dossier", label: "Dossier", description: "Every proof point.", default: false },
    { id: "editorial", label: "Editorial", description: "A magazine profile.", default: false },
  ];

  it("should expose the registry families, not the five retired themes", () => {
    const VT = loadVisualThemes({ MATERIALS_TEMPLATE_FAMILIES: families });
    assert.deepEqual(
      JSON.parse(JSON.stringify(VT.VISUAL_THEMES)).map((t) => t.id),
      ["signal", "dossier", "editorial"],
    );
    assert.equal(VT.getDefaultVisualThemeId(), "signal");
    assert.equal(VT.resolveVisualTheme("dossier").id, "dossier", "a family id resolves to itself");
    assert.equal(VT.resolveVisualTheme("").id, "signal", "a missing id resolves to the default");
    assert.equal(VT.resolveVisualTheme("nope").id, "signal", "an unknown id resolves to the default");
  });

  it("should map the retired theme ids to their registry families", () => {
    const VT = loadVisualThemes({ MATERIALS_TEMPLATE_FAMILIES: families });
    assert.equal(VT.resolveVisualTheme("classic").id, "signal");
    assert.equal(VT.resolveVisualTheme("compact").id, "signal");
    assert.equal(VT.resolveVisualTheme("serif_emphasis").id, "editorial");
    assert.equal(VT.resolveVisualTheme("muted").id, "signal");
    assert.equal(VT.resolveVisualTheme("high_contrast").id, "signal");
  });

  it("should fall back to the registry families when the store is not loaded yet", () => {
    const VT = loadVisualThemes();
    assert.deepEqual(
      JSON.parse(JSON.stringify(VT.VISUAL_THEMES)).map((t) => t.id).sort(),
      [...familyIds()].sort(),
      "the adapter fallback stays identical to the server registry list",
    );
    assert.equal(VT.getDefaultVisualThemeId(), "signal");
    assert.equal(VT.resolveVisualTheme("editorial").label, "Editorial");
  });
});

describe("slice 7: no code path reads the retired theme system", () => {
  /** Root scripts, partials and stylesheets — the whole browser surface. */
  function browserFiles() {
    const files = [];
    for (const entry of readdirSync(repoRoot, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith(".js")) files.push(entry.name);
    }
    for (const dir of ["partials", "css"]) {
      for (const entry of readdirSync(join(repoRoot, dir), { withFileTypes: true })) {
        if (entry.isFile()) files.push(`${dir}/${entry.name}`);
      }
    }
    return files.sort();
  }

  it("should reference visualThemeId only in the store migration", () => {
    const hits = browserFiles().filter((f) => readRoot(f).includes("visualThemeId"));
    assert.deepEqual(hits, ["user-content-store.js"]);
  });

  it("should set no data-visual-theme attribute anywhere", () => {
    const hits = browserFiles().filter((f) => readRoot(f).includes("data-visual-theme"));
    assert.deepEqual(hits, []);
  });

  it("should keep neither of the retired theme select ids", () => {
    const hits = browserFiles().filter(
      (f) => readRoot(f).includes("resumeGenerateVisualTheme") || readRoot(f).includes("prefVisualTheme"),
    );
    assert.deepEqual(hits, []);
  });
});

describe("slice 7: the preview uses the registry family and accent/density knobs", () => {
  const generation = readRoot("resume-generation.js");
  const css = readRoot("css/materials.css");
  const prefsModal = readRoot("partials/profile-materials-modal.html");
  const generateModal = readRoot("partials/resume-generation-modals.html");
  const feature = readRoot("materials-feature.js");
  const profileMaterials = readRoot("profile-materials.js");
  const scribe = readRoot("scribe.js");
  const fixture = readRoot("tests/fixtures/scribe/scribe-dom.mjs");

  it("should drive the generate-modal preview from materialsTemplate + accent + density", () => {
    assert.match(generation, /getElementById\("resumeGenerateTemplate"\)/);
    assert.match(generation, /setAttribute\("data-family"/);
    assert.match(generation, /setAttribute\("data-accent"/);
    assert.match(generation, /setAttribute\("data-density"/);
    assert.match(generation, /prefs\.materialsTemplate/);
    assert.match(generation, /savePreferences\(\{ materialsTemplate/);
  });

  it("should skin the preview per family with an ink accent, scoped under .doc-preview", () => {
    for (const family of ["signal", "dossier", "editorial"]) {
      assert.match(css, new RegExp(`\\.doc-preview\\[data-family="${family}"\\]`), family);
    }
    assert.match(css, /\.doc-preview\[data-accent="ink"\]/);
    assert.match(css, /\.doc-preview\[data-density=/);
  });

  it("should offer one Template select plus an Accent knob in Profile & Materials", () => {
    const templatesGroup = prefsModal.slice(
      prefsModal.indexOf("Templates &amp; appearance"),
      prefsModal.indexOf("Voice &amp; targeting"),
    );
    assert.match(templatesGroup, /<select[\s\S]*?id="prefMaterialsTemplate"/);
    assert.match(templatesGroup, /<select[\s\S]*?id="prefMaterialsAccent"/);
    assert.doesNotMatch(prefsModal, /prefVisualTheme/);
    assert.match(profileMaterials, /fillMaterialsAccentSelect\("prefMaterialsAccent", prefs\.materialsAccent\)/);
    assert.match(feature, /getElementById\("prefMaterialsAccent"\)/);
    assert.match(feature, /materialsAccent:\s*\n?\s*\(materialsAccentEl && materialsAccentEl\.value\)/);
  });

  it("should rename the footer select to the one template select", () => {
    assert.match(generateModal, /id="resumeGenerateTemplate"/);
    assert.match(generateModal, /for="resumeGenerateTemplate"/);
    assert.doesNotMatch(generateModal, /resumeGenerateVisualTheme/);
  });

  it("should mirror the renamed select in Scribe and its fixture", () => {
    assert.match(scribe, /getElementById\("resumeGenerateTemplate"\)/);
    assert.doesNotMatch(scribe, /resumeGenerateVisualTheme/);
    assert.match(fixture, /legacySel\.id = "resumeGenerateTemplate"/);
  });
});
