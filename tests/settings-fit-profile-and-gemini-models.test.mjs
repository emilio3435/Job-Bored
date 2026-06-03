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
});

describe("Settings Gemini model menu", () => {
  it("offers only the current approved Gemini models", () => {
    const options = loadModelOptions();
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
