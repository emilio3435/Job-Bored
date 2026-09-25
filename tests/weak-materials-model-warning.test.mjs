import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const modelCatalogJs = readFileSync(join(repoRoot, "model-catalog.js"), "utf8");

function fakeLocalStorage() {
  const store = new Map();
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
}

function loadCatalog() {
  const ctx = {
    window: {},
    console: { log() {}, warn() {}, error() {} },
    fetch: async () => {
      throw new Error("no fetchImpl provided");
    },
    localStorage: fakeLocalStorage(),
    Date,
  };
  vm.createContext(ctx);
  vm.runInContext(modelCatalogJs, ctx, { filename: "model-catalog.js" });
  return ctx.window.JobBoredModelCatalog;
}

describe("JobBoredModelCatalog.isWeakMaterialsModel", () => {
  it("flags openai/gpt-oss-120b:free as too weak for tailored letters", () => {
    const api = loadCatalog();
    assert.equal(typeof api.isWeakMaterialsModel, "function");
    assert.equal(api.isWeakMaterialsModel("openai/gpt-oss-120b:free"), true);
  });
});

describe("setup weak model copy", () => {
  it("uses the spec warning string", () => {
    const src = readFileSync(new URL("../oneflow-beat-ai.js", import.meta.url), "utf8");
    assert.match(
      src,
      /This model is too weak for tailored letters\. Use Gemini Flash unless you are only testing\./,
    );
  });
});
