import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const schemaJs = readFileSync(join(repoRoot, "settings-tab-schema.js"), "utf8");
const resumeGenerateJs = readFileSync(join(repoRoot, "resume-generate.js"), "utf8");
const settingsModalJs = readFileSync(join(repoRoot, "settings-modal.js"), "utf8");
const modelCatalogJs = readFileSync(join(repoRoot, "model-catalog.js"), "utf8");
const fitProfileEditorJs = readFileSync(
  join(repoRoot, "fit-profile-editor.js"),
  "utf8",
);

function loadSettingsSchema() {
  const ctx = { window: {} };
  vm.createContext(ctx);
  vm.runInContext(schemaJs, ctx, { filename: "settings-tab-schema.js" });
  return ctx.window.JobBoredSettingsTabSchema;
}

function loadModelOptions() {
  const ctx = { window: {} };
  vm.createContext(ctx);
  vm.runInContext(resumeGenerateJs, ctx, { filename: "resume-generate.js" });
  return ctx.window.CommandCenterResumeModelOptions;
}

function loadCatalog() {
  const ctx = {
    window: {},
    console: { log() {}, warn() {}, error() {} },
    fetch: async () => {
      throw new Error("no fetch");
    },
    localStorage: {
      getItem: () => null,
      setItem() {},
      removeItem() {},
    },
    Date,
  };
  vm.createContext(ctx);
  vm.runInContext(modelCatalogJs, ctx, { filename: "model-catalog.js" });
  return ctx.window.JobBoredModelCatalog;
}

describe("Settings Fit Profile tab", () => {
  it("registers the Fit Profile tab with the settings tab controller", () => {
    const schema = loadSettingsSchema();
    assert.equal(schema.SETTINGS_TAB_IDS.FIT_PROFILE, "fit_profile");
    assert.deepEqual(JSON.parse(JSON.stringify(schema.getSettingsTabMeta("fit_profile"))), {
      id: "fit_profile",
      label: "Fit Profile",
      panelId: "settings-panel-fit-profile",
      buttonId: "settings-tab-fit-profile",
    });
    assert.ok(
      schema.getSettingsTabOrder().includes("fit_profile"),
      "Fit Profile must be in tab order so clicks can activate the panel",
    );
  });

  it("F2B-PROFILE01-EDIT: Open full wizard asks the wizard for edit-in-place, not a blank hash create", () => {
    const start = fitProfileEditorJs.indexOf("fitProfileOpenWizardBtn");
    assert.ok(start >= 0, "Open full wizard button must exist");
    const snippet = fitProfileEditorJs.slice(start, start + 900);
    assert.match(
      snippet,
      /openFitProfileWizard/,
      "Settings must call the wizard opener instead of only flipping the onboarding hash",
    );
    assert.match(
      snippet,
      /mode:\s*["']edit["']/,
      "Open full wizard on a saved profile is edit mode, not blank create",
    );
    assert.doesNotMatch(
      snippet,
      /location\.hash\s*=\s*["']#\/onboarding\/fit-profile["']/,
      "must not bounce to the blank onboarding hash over a saved profile",
    );
  });
});

describe("Settings Gemini model menu", () => {
  it("offers only the current approved Gemini models", () => {
    const options = loadModelOptions();
    const catalog = loadCatalog();
    const catalogValues = JSON.parse(
      JSON.stringify(catalog.getStaticModels("gemini").map((option) => option.value)),
    );
    assert.equal(catalogValues[0], "gemini-flash");
    assert.deepEqual(catalogValues, [
      "gemini-flash",
      "gemini-3.5-flash",
      "gemini-3.1-pro-preview",
      "gemini-3-flash-preview",
      "gemini-3.1-flash-lite-preview",
    ]);
    assert.deepEqual(
      JSON.parse(JSON.stringify(options.gemini.map((option) => option.value))),
      [
        "gemini-3.1-pro-preview",
        "gemini-3.5-flash",
        "gemini-3-flash-preview",
        "gemini-3.1-flash-lite-preview",
      ],
    );
    assert.ok(
      options.gemini.every((option) => option.description && /Pro:|Con:/.test(option.description)),
      "each Gemini option should carry a short tooltip description with pros/cons",
    );
    assert.ok(
      !options.gemini.some((option) => /gemini-2\.|gemini-1\./.test(option.value)),
      "deprecated Gemini 1.x/2.x models must not appear in Settings",
    );
  });

  it("Settings save POSTs the selected provider pin to /api/llm-config", () => {
    assert.match(settingsModalJs, /jobBoredApiUrl \+ "\/api\/llm-config"/);
    assert.match(settingsModalJs, /method:\s*"POST"/);
  });

  it("uses option and select titles as hover/selected tooltips", () => {
    assert.match(
      settingsModalJs,
      /if \(o\.description\) opt\.title = o\.description;/,
      "option hover tooltips should be populated from model descriptions",
    );
    assert.match(
      settingsModalJs,
      /function updateModelSelectTooltip/,
      "selected model tooltip helper should exist",
    );
    assert.match(
      settingsModalJs,
      /sel\.title = title;/,
      "the selected model description should become the select title",
    );
  });

  it("does not preserve unsupported saved Gemini models in the dropdown", () => {
    assert.match(settingsModalJs, /const isGeminiSelect = selectId === "settingsResumeGeminiModel";/);
    assert.match(settingsModalJs, /v && !values\.has\(v\) && !isGeminiSelect/);
  });
});
