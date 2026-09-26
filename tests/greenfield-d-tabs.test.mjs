import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

/* ============================================================
   GREENFIELD D3 · tab collapse.

   Setup + Sheet were two tabs asking for two halves of the same Google
   connection; AI Providers was a shelf of six panels named after vendors.
   One "Google" tab and one "AI" tab, with every field DOM id unchanged
   (they are load-bearing across app.js validation routing, the drawer,
   apps-script-deploy.js, and the Playwright suites).
   ============================================================ */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const schemaJs = readFileSync(join(repoRoot, "settings-tab-schema.js"), "utf8");
const modalHtml = readFileSync(
  join(repoRoot, "partials", "settings-modal.html"),
  "utf8",
);

function loadSchema() {
  const window = {};
  const ctx = vm.createContext({ window, console });
  vm.runInContext(schemaJs, ctx, { filename: "settings-tab-schema.js" });
  return window.JobBoredSettingsTabSchema;
}

/** Field ids that must keep mapping somewhere — the app focuses them by id. */
const GOOGLE_FIELDS = [
  "settingsOAuthClientId",
  "settingsOAuthClientIdLabel",
  "profileResetWizardBtn",
  "infraResetWizardBtn",
  "settingsClearConfirmBar",
  "settingsClearBtn",
  "settingsClearConfirmCancel",
  "settingsClearConfirmYes",
  "settingsJbV2Toggle",
  "settingsJbV2ToggleLabel",
  "settingsJbV2ToggleHint",
  "settingsSheetId",
  "settingsTitle",
];

const AI_FIELDS = [
  "settingsResumeProvider",
  "settingsPanelGemini",
  "settingsResumeGeminiApiKey",
  "settingsResumeGeminiModel",
  "settingsPanelOpenAI",
  "settingsResumeOpenAIApiKey",
  "settingsResumeOpenAIModel",
  "settingsPanelAnthropic",
  "settingsResumeAnthropicApiKey",
  "settingsResumeAnthropicModel",
  "settingsPanelWebhook",
  "settingsResumeGenerationWebhookUrl",
];

describe("D3 · TAB_ORDER collapses Setup + Sheet into google, AI Providers into ai", () => {
  it("orders google and ai, and drops setup / sheet / ai_providers", () => {
    const schema = loadSchema();
    const order = schema.getSettingsTabOrder();
    assert.ok(order.includes("google"), 'TAB_ORDER must contain "google"');
    assert.ok(order.includes("ai"), 'TAB_ORDER must contain "ai"');
    for (const gone of ["setup", "sheet", "ai_providers"]) {
      assert.equal(
        order.includes(gone),
        false,
        `TAB_ORDER must no longer contain "${gone}"`,
      );
    }
  });

  it("keeps Fit Profile, Scraping, ATS Scoring and Upgrades untouched", () => {
    const schema = loadSchema();
    const order = schema.getSettingsTabOrder();
    for (const keep of ["fit_profile", "scraping", "ats_scoring", "upgrades"]) {
      assert.ok(order.includes(keep), `${keep} must survive the collapse`);
    }
  });

  it("labels google 'Google' and ai 'AI'", () => {
    const schema = loadSchema();
    assert.equal(schema.getSettingsTabMeta("google").label, "Google");
    assert.equal(schema.getSettingsTabMeta("ai").label, "AI");
    assert.equal(schema.SETTINGS_TAB_IDS.GOOGLE, "google");
    assert.equal(schema.SETTINGS_TAB_IDS.AI, "ai");
  });

  it("defaults to the google tab", () => {
    const schema = loadSchema();
    assert.equal(schema.DEFAULT_TAB, "google");
  });

  it("maps every former Setup or Sheet field to google", () => {
    const schema = loadSchema();
    for (const id of GOOGLE_FIELDS) {
      assert.equal(
        schema.getSettingsTabForField(id),
        "google",
        `${id} must route to the google tab`,
      );
    }
  });

  it("maps every AI provider field to ai", () => {
    const schema = loadSchema();
    for (const id of AI_FIELDS) {
      assert.equal(
        schema.getSettingsTabForField(id),
        "ai",
        `${id} must route to the ai tab`,
      );
    }
  });

  it("no field still routes to a retired tab id", () => {
    const schema = loadSchema();
    const retired = new Set(["setup", "sheet", "ai_providers"]);
    for (const id of [...GOOGLE_FIELDS, ...AI_FIELDS]) {
      assert.equal(
        retired.has(schema.getSettingsTabForField(id)),
        false,
        `${id} still points at a retired tab`,
      );
    }
  });
});

describe("D3 · the partial matches the schema", () => {
  it("renders a google tab button and panel, and no setup/sheet ones", () => {
    assert.match(modalHtml, /data-tab-id="google"/);
    assert.match(modalHtml, /id="settings-panel-google"/);
    assert.match(modalHtml, /id="settings-tab-google"/);
    assert.doesNotMatch(modalHtml, /data-tab-id="setup"/);
    assert.doesNotMatch(modalHtml, /data-tab-id="sheet"/);
    assert.doesNotMatch(modalHtml, /id="settings-panel-setup"/);
    assert.doesNotMatch(modalHtml, /id="settings-panel-sheet"/);
  });

  it("renders an ai tab button and panel, and no ai_providers one", () => {
    assert.match(modalHtml, /data-tab-id="ai"/);
    assert.match(modalHtml, /id="settings-panel-ai"/);
    assert.match(modalHtml, /id="settings-tab-ai"/);
    assert.doesNotMatch(modalHtml, /data-tab-id="ai_providers"/);
    assert.doesNotMatch(modalHtml, /id="settings-panel-ai-providers"/);
  });

  it("every schema panel id and button id exists in the partial", () => {
    const schema = loadSchema();
    for (const tabId of schema.getSettingsTabOrder()) {
      const meta = schema.getSettingsTabMeta(tabId);
      assert.ok(meta, `${tabId} needs TAB_META`);
      assert.ok(
        modalHtml.includes(`id="${meta.panelId}"`),
        `partial is missing panel ${meta.panelId}`,
      );
      assert.ok(
        modalHtml.includes(`id="${meta.buttonId}"`),
        `partial is missing tab button ${meta.buttonId}`,
      );
    }
  });

  it("keeps every field DOM id stable", () => {
    for (const id of [...GOOGLE_FIELDS, ...AI_FIELDS]) {
      assert.ok(
        modalHtml.includes(`id="${id}"`),
        `field DOM id ${id} must not change`,
      );
    }
  });
});
