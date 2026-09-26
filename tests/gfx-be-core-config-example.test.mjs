import assert from "node:assert/strict";
import { describe, it } from "node:test";
import vm from "node:vm";
import { readRepoFile } from "./oneflow-l0-harness.mjs";

/* ============================================================
   GFX BE-CORE · N-B2-2 + B2-8 + D3 — config.example.js defaults.

   setup.mjs copies config.example.js to config.js, so every value here
   is a greenfield user's config.
     N-B2-2  a pinned OpenRouter model overrode the catalog default and
             fired the weak-model warning on the "Recommended" path
     B2-8    the AI Studio link lands on the key page, not the root
     D3      Gemini is the default and documented as such
   ============================================================ */

const source = readRepoFile("config.example.js");

function loadConfig() {
  const window = {};
  vm.runInContext(source, vm.createContext({ window }), { filename: "config.example.js" });
  return window.COMMAND_CENTER_CONFIG;
}

describe("config.example.js greenfield defaults", () => {
  it("N-B2-2 resumeOpenRouterModel is empty so the catalog default applies", () => {
    assert.equal(loadConfig().resumeOpenRouterModel, "");
  });

  it("B2-8 every AI Studio link points at /app/apikey", () => {
    const links = source.match(/https:\/\/aistudio\.google\.com[^\s"'`)]*/g) || [];
    assert.ok(links.length >= 1, "the Gemini key link is documented");
    for (const link of links) {
      assert.equal(link, "https://aistudio.google.com/app/apikey");
    }
  });

  it("D3 Gemini is the default provider and documented as the default", () => {
    assert.equal(loadConfig().resumeProvider, "gemini");
    assert.match(source, /Provider: "gemini" \(default\)/);
    assert.match(source, /Gemini \(recommended default\)/);
  });
});
