/* ============================================================
   ux01-e-surfaces.test.mjs — UX01 lane E, the smaller surfaces.
   C12 (TA-18, TR-24, AX-22): a missing AI provider is one inline
        dossier notice, never a red toast per open.
   C12 (TA-22): the materials dock steps aside while a dossier is open.
   ============================================================ */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => readFileSync(join(repoRoot, f), "utf8");

describe("C12 · the missing-AI notice is inline, not a toast", () => {
  const src = read("posting-enrichment.js");

  it("should not raise the provider-missing message as a toast", () => {
    assert.doesNotMatch(src, /showToast\(\s*AI_PROVIDER_CONFIG_MISSING_TOAST/);
  });

  it("should expose the notice for the dossier to render", () => {
    const window = {
      addEventListener() {},
      CommandCenterJobPostingInsights: { canEnrichWithLLM: () => false },
      JobBoredApp: {},
    };
    const ctx = vm.createContext({ window, document: { addEventListener() {} }, console, CustomEvent: class {}, setTimeout, clearTimeout, AbortController });
    vm.runInContext(src, ctx, { filename: "posting-enrichment.js" });
    const api = window.JobBoredPostingEnrichment;
    assert.equal(typeof api?.getProviderNotice, "function");
    assert.match(api.getProviderNotice(), /Settings → AI Providers/);
    window.CommandCenterJobPostingInsights.canEnrichWithLLM = () => true;
    assert.equal(api.getProviderNotice(), "");
  });
});

describe("C12 · the materials dock steps aside for an open dossier", () => {
  function boot(openKey) {
    const attrs = {};
    const region = {
      setAttribute: (k, v) => { attrs[k] = v; },
      removeAttribute: (k) => { delete attrs[k]; },
      getAttribute: (k) => attrs[k] ?? null,
      addEventListener() {},
      set innerHTML(v) {}, get innerHTML() { return ""; },
      hidden: true,
      querySelectorAll: () => [],
    };
    const winListeners = new Map();
    const window = {
      COMMAND_CENTER_CONFIG: { jobPostingScrapeUrl: "" },
      JobBoredFlowing: { openRole: { get: () => openKey } },
      addEventListener: (t, fn) => winListeners.set(t, fn),
    };
    const document = {
      readyState: "complete",
      querySelector: (sel) => (sel.includes("materials-queue") ? region : null),
      querySelectorAll: () => [],
      addEventListener() {},
    };
    const ctx = vm.createContext({ window, document, console, fetch: () => Promise.reject(new Error("off")), setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, Date, Promise });
    vm.runInContext(read("materials-queue.js"), ctx, { filename: "materials-queue.js" });
    return { attrs, winListeners };
  }

  it("should hide the dock while a role is open and bring it back on close", () => {
    const { attrs, winListeners } = boot("7");
    assert.equal(attrs["data-dossier-open"], "true");
    winListeners.get("jb:role:closed")();
    assert.equal(attrs["data-dossier-open"], undefined);
    winListeners.get("jb:role:opened")();
    assert.equal(attrs["data-dossier-open"], "true");
  });

  it("should carry the rule that hides it", () => {
    assert.match(read("materials-queue.css"), /\[data-region="materials-queue"\]\[data-dossier-open="true"\]\s*\{\s*display:\s*none;/);
  });
});
