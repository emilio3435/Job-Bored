/**
 * HOLES PROV · P3 (browser): Settings offers gemini-pro and gemini-flash-lite
 * as logical family names, exactly like gemini-flash. Google serves none of
 * the three literal ids, so the wire call must use its moving aliases while
 * the saved choice stays the family name.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (name) => readFileSync(join(repoRoot, name), "utf8");
const outputBudgetJs = read("llm-output-budget.js");
const resumeGenerateJs = read("resume-generate.js");
const modelCatalogJs = read("model-catalog.js");

const GOOGLE_ALIASES = ["gemini-flash-latest", "gemini-pro-latest", "gemini-flash-lite-latest"];
const GEMINI_URL = (id) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${id}:generateContent`;

function load(config = {}) {
  const calls = [];
  const ctx = {
    window: { COMMAND_CENTER_CONFIG: config },
    console: { log() {}, warn() {}, error() {} },
    fetch: async (url, init) => {
      calls.push({ url: String(url), init });
      return {
        ok: true,
        status: 200,
        json: async () => ({ candidates: [{ content: { parts: [{ text: "ok" }] } }] }),
      };
    },
  };
  vm.createContext(ctx);
  vm.runInContext(outputBudgetJs, ctx, { filename: "llm-output-budget.js" });
  vm.runInContext(resumeGenerateJs, ctx, { filename: "resume-generate.js" });
  vm.runInContext(modelCatalogJs, ctx, { filename: "model-catalog.js" });
  return { win: ctx.window, calls };
}

describe("HOLES PROV P3 · every Gemini option reaches Google as a served alias", () => {
  it("resolves each Settings and catalog Gemini option to one of Google's moving aliases", () => {
    const { win } = load();
    const values = [
      ...Array.from(win.CommandCenterResumeModelOptions.gemini, (o) => o.value),
      ...Array.from(win.JobBoredModelCatalog.STATIC.gemini, (o) => o.value),
    ];
    assert.ok(values.length >= 6, "both lists offer the three Gemini families");
    for (const value of values) {
      const wire = win.JobBoredResolveGeminiFlashAlias(value);
      assert.ok(
        GOOGLE_ALIASES.includes(wire),
        `option "${value}" goes to Google as "${wire}", which Google does not serve`,
      );
    }
  });

  it("maps gemini-pro and gemini-flash-lite case-insensitively and through a models/ prefix", () => {
    const resolve = load().win.JobBoredResolveGeminiFlashAlias;
    assert.equal(resolve("gemini-pro"), "gemini-pro-latest");
    assert.equal(resolve("  Gemini-Pro  "), "gemini-pro-latest");
    assert.equal(resolve("models/GEMINI-PRO"), "gemini-pro-latest");
    assert.equal(resolve("gemini-flash-lite"), "gemini-flash-lite-latest");
    assert.equal(resolve("models/Gemini-Flash-Lite"), "gemini-flash-lite-latest");
    assert.equal(resolve("gemini-flash"), "gemini-flash-latest", "the Flash family is unchanged");
  });

  it("passes version pins and Google's own aliases through untouched", () => {
    const resolve = load().win.JobBoredResolveGeminiFlashAlias;
    for (const id of ["gemini-2.5-pro", "gemini-3.5-flash", "gemini-pro-latest", "gemini-flash-lite-latest"]) {
      assert.equal(resolve(id), id);
    }
  });

  it("keeps the saved preference and the option values as logical family names", () => {
    const { win } = load();
    const normalize = win.JobBoredNormalizeGeminiFlashPreference;
    assert.equal(normalize("gemini-pro"), "gemini-pro");
    assert.equal(normalize("gemini-flash-lite"), "gemini-flash-lite");
    assert.deepEqual(
      Array.from(win.CommandCenterResumeModelOptions.gemini, (o) => o.value),
      ["gemini-flash", "gemini-pro", "gemini-flash-lite"],
    );
    assert.deepEqual(
      Array.from(win.JobBoredModelCatalog.STATIC.gemini, (o) => o.value),
      ["gemini-flash", "gemini-pro", "gemini-flash-lite"],
    );
  });

  for (const [family, alias] of [
    ["gemini-pro", "gemini-pro-latest"],
    ["gemini-flash-lite", "gemini-flash-lite-latest"],
  ]) {
    it(`a configured ${family} posts to ${alias} from both inline AI and drafting`, async () => {
      const { win, calls } = load({
        resumeProvider: "gemini",
        resumeGeminiApiKey: "fictional-key",
        resumeGeminiModel: family,
      });
      const reply = await win.CommandCenterBrowserAiProvider.callConfiguredAi("sys", "user", {});
      assert.equal(reply, "ok");
      await win.CommandCenterResumeGenerate.generateFromBundle({
        feature: "resume",
        profile: { name: "Sample" },
        job: { title: "SRE" },
      });
      assert.deepEqual(
        calls.map((call) => call.url),
        [GEMINI_URL(alias), GEMINI_URL(alias)],
      );
      assert.deepEqual(
        calls.map((call) => JSON.parse(call.init.body).generationConfig.maxOutputTokens),
        [8192, 65536],
        "inline suggestions stay short; drafting uses the current Gemini ceiling",
      );
    });
  }
});
