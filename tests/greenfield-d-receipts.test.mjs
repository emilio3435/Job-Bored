import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

/* ============================================================
   GREENFIELD D4 · receipts, D5 · webhook fields gone + one default table.

   Settings used to re-ask for what the six beats already collected. The
   Google and AI panels now open with a receipt of what setup holds and a
   "Change in setup" button that deep-links into the beat and returns
   (open(beat, { returnTo: "close" })).

   D5: the discovery webhook URL/secret belong to the drawer's Connection
   tab — Settings neither populates nor saves them; and one exported table
   (JobBoredModelCatalog.DEFAULT_MODEL_BY_PROVIDER) is the only source of a
   provider's default model, so settings-modal.js and oneflow-beat-ai.js
   cannot drift (they had drifted: gpt-4o-mini vs gpt-5.6-terra).
   ============================================================ */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const settingsModalJs = readFileSync(
  join(repoRoot, "settings-modal.js"),
  "utf8",
);
const modelCatalogJs = readFileSync(join(repoRoot, "model-catalog.js"), "utf8");
const oneflowBeatAiJs = readFileSync(
  join(repoRoot, "oneflow-beat-ai.js"),
  "utf8",
);
const modalHtml = readFileSync(
  join(repoRoot, "partials", "settings-modal.html"),
  "utf8",
);

/** vm contexts have their own realm, so object prototypes never match. */
const plain = (v) => JSON.parse(JSON.stringify(v));

const EXPECTED_DEFAULTS = {
  openrouter: "openai/gpt-oss-120b:free",
  gemini: "gemini-3.5-flash",
  openai: "gpt-5.6-terra",
  anthropic: "claude-sonnet-5",
  local: "gemma4:e2b",
};

function makeEl(overrides = {}) {
  return {
    value: "",
    textContent: "",
    style: {},
    hidden: false,
    disabled: false,
    dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    addEventListener() {},
    getAttribute() {
      return null;
    },
    setAttribute() {},
    appendChild() {},
    querySelectorAll: () => [],
    ...overrides,
  };
}

function loadSettings({
  effectiveConfig = {},
  ids = [],
  selectors = {},
  userEmail = "",
  oneFlow = null,
} = {}) {
  const els = new Map();
  for (const id of ids) els.set(id, makeEl());
  const selEls = new Map();
  for (const [sel, el] of Object.entries(selectors)) selEls.set(sel, el);
  const closed = [];
  const opened = [];
  const window = {
    JobBoredApp: {
      settings: {},
      configCore: { getEffectiveConfig: () => ({ ...effectiveConfig }) },
      auth: { getUserEmail: () => userEmail },
      core: {
        host: {
          parseGoogleSheetId: (raw) => {
            const s = String(raw || "").trim();
            return /^[A-Za-z0-9_-]{20,}$/.test(s) ? s : null;
          },
          normalizeDashboardTitle: (v) => String(v || "").trim() || "JobBored",
          readStoredConfigOverrides: () => ({}),
          mergeStoredConfigOverridePatch: (p) => p,
          getUserEmail: () => userEmail,
          resolveGeminiModel: () => "gemini-flash",
          renderAppsScriptDeployUi() {},
          showToast() {},
        },
      },
    },
    JobBoredOneFlow:
      oneFlow === null
        ? {
            open(beatId, options) {
              opened.push({ beatId, options });
              return Promise.resolve();
            },
          }
        : oneFlow,
    JobBoredModelCatalog: {
      DEFAULT_MODEL_BY_PROVIDER: { ...EXPECTED_DEFAULTS },
      getStaticModels: () => [],
      getProviderModels: async () => ({ models: [] }),
    },
    COMMAND_CENTER_CONFIG: {},
    location: { reload() {} },
  };
  const document = {
    readyState: "loading",
    getElementById: (id) => (els.has(id) ? els.get(id) : null),
    querySelector: (sel) => (selEls.has(sel) ? selEls.get(sel) : null),
    querySelectorAll: (sel) => (selEls.has(sel) ? [selEls.get(sel)] : []),
    addEventListener() {},
    createElement: () => makeEl(),
  };
  const ctx = vm.createContext({
    window,
    document,
    console,
    setTimeout: () => 0,
    clearTimeout() {},
    URL,
    JSON,
    Promise,
    Object,
    String,
    Array,
    requestAnimationFrame: (fn) => fn(),
  });
  vm.runInContext(settingsModalJs, ctx, { filename: "settings-modal.js" });
  // The close path is stubbed after load so the module's own reference wins.
  const api = window.JobBoredApp.settings;
  return { api, els, selEls, opened, closed, window };
}

describe("D4 · the Google receipt reports what setup already holds", () => {
  it("shows the Sheet title and the signed-in email when both are present", () => {
    const { api } = loadSettings({
      effectiveConfig: {
        sheetId: "1AbCdEfGhIjKlMnOpQrStUvWxYz012345",
        title: "Emilio's board",
      },
      userEmail: "emilio@example.com",
    });
    const receipt = api.buildSettingsReceipt("google");
    assert.equal(receipt.connected, true);
    assert.match(receipt.text, /Emilio's board/);
    assert.match(receipt.text, /emilio@example\.com/);
  });

  it("falls back to the Sheet id when no custom title is set", () => {
    const { api } = loadSettings({
      effectiveConfig: { sheetId: "1AbCdEfGhIjKlMnOpQrStUvWxYz012345" },
      userEmail: "",
    });
    const receipt = api.buildSettingsReceipt("google");
    assert.equal(receipt.connected, true);
    assert.match(receipt.text, /1AbCdEfGhIjKlMnOpQrStUvWxYz012345/);
  });

  it("says Not connected with no Sheet at all", () => {
    const { api } = loadSettings({ effectiveConfig: {}, userEmail: "" });
    const receipt = api.buildSettingsReceipt("google");
    assert.equal(receipt.connected, false);
    assert.equal(receipt.text, "Not connected");
  });
});

describe("D4 · the AI receipt names the provider and model", () => {
  it("shows provider · model from the effective config", () => {
    const { api } = loadSettings({
      effectiveConfig: {
        resumeProvider: "openrouter",
        resumeOpenRouterApiKey: "sk-or-x",
        resumeOpenRouterModel: "openai/gpt-oss-120b:free",
      },
    });
    const receipt = api.buildSettingsReceipt("ai");
    assert.equal(receipt.connected, true);
    assert.match(receipt.text, /OpenRouter/);
    assert.match(receipt.text, /openai\/gpt-oss-120b:free/);
  });

  it("falls back to the catalog default model when none is stored", () => {
    const { api } = loadSettings({
      effectiveConfig: {
        resumeProvider: "anthropic",
        resumeAnthropicApiKey: "sk-ant-x",
      },
    });
    const receipt = api.buildSettingsReceipt("ai");
    assert.match(receipt.text, /claude-sonnet-5/);
  });

  it("says Not connected when no provider has been set up", () => {
    const { api } = loadSettings({ effectiveConfig: {} });
    const receipt = api.buildSettingsReceipt("ai");
    assert.equal(receipt.connected, false);
    assert.equal(receipt.text, "Not connected");
  });
});

describe("D4 · renderSettingsReceipts writes into the receipt blocks", () => {
  it("fills [data-receipt-state] for google and ai", () => {
    const googleState = makeEl();
    const aiState = makeEl();
    const { api } = loadSettings({
      effectiveConfig: {
        sheetId: "1AbCdEfGhIjKlMnOpQrStUvWxYz012345",
        resumeProvider: "gemini",
        resumeGeminiApiKey: "AIza-x",
      },
      userEmail: "emilio@example.com",
      selectors: {
        '[data-receipt-state="google"]': googleState,
        '[data-receipt-state="ai"]': aiState,
      },
    });
    api.renderSettingsReceipts();
    assert.match(googleState.textContent, /emilio@example\.com/);
    assert.match(aiState.textContent, /Gemini/);
  });
});

describe("D4 · settings_change_in_setup deep-links into the beat and returns", () => {
  it("closes the modal, then opens the beat with returnTo: close", () => {
    const { api, opened, els } = loadSettings({
      ids: ["settingsModal"],
      effectiveConfig: {},
    });
    api.settingsChangeInSetup("google");
    assert.deepEqual(plain(opened), [
      { beatId: "google", options: { returnTo: "close" } },
    ]);
    assert.equal(
      els.get("settingsModal").style.display,
      "none",
      "the modal must be closed before the shell opens",
    );
  });

  it("routes the AI receipt button at the ai beat", () => {
    const { api, opened } = loadSettings({ ids: ["settingsModal"] });
    api.settingsChangeInSetup("ai");
    assert.deepEqual(plain(opened), [
      { beatId: "ai", options: { returnTo: "close" } },
    ]);
  });

  it("does not throw when the one-flow global is absent", () => {
    const { api } = loadSettings({ ids: ["settingsModal"], oneFlow: undefined });
    assert.doesNotThrow(() => api.settingsChangeInSetup("google"));
  });
});

describe("D4 · the partial carries the receipt blocks", () => {
  it("has a google receipt with a state node and a change button", () => {
    assert.match(modalHtml, /data-receipt="google"/);
    assert.match(modalHtml, /data-receipt-state="google"/);
    assert.match(
      modalHtml,
      /data-action="settings_change_in_setup"[\s\S]{0,200}data-beat="google"|data-beat="google"[\s\S]{0,200}data-action="settings_change_in_setup"/,
    );
  });

  it("has an ai receipt with a state node and a change button", () => {
    assert.match(modalHtml, /data-receipt="ai"/);
    assert.match(modalHtml, /data-receipt-state="ai"/);
    assert.match(
      modalHtml,
      /data-action="settings_change_in_setup"[\s\S]{0,200}data-beat="ai"|data-beat="ai"[\s\S]{0,200}data-action="settings_change_in_setup"/,
    );
  });

  it("points at the drawer for discovery credentials instead of duplicating them", () => {
    assert.match(modalHtml, /Discovery connection lives in the drawer/);
  });
});

describe("D5 · the drawer owns the discovery webhook fields", () => {
  it("the settings partial has no webhook URL or secret input", () => {
    assert.doesNotMatch(modalHtml, /id="settingsDiscoveryWebhookUrl"/);
    assert.doesNotMatch(modalHtml, /id="settingsDiscoveryWebhookSecret"/);
  });

  it("settings-modal.js no longer populates or saves them", () => {
    const populate = settingsModalJs.slice(
      settingsModalJs.indexOf("function populateCommandCenterSettingsForm()"),
      settingsModalJs.indexOf("   Receipts, not asks"),
    );
    const save = settingsModalJs.slice(
      settingsModalJs.indexOf("async function saveCommandCenterSettingsFromForm()"),
      settingsModalJs.indexOf("function performSettingsClearOverrides"),
    );
    assert.ok(populate.length > 0 && save.length > 0, "both slices must be found");
    for (const [name, body] of [["populate", populate], ["save", save]]) {
      assert.equal(
        body.includes("settingsDiscoveryWebhookUrl"),
        false,
        `${name} must not read the drawer-owned webhook URL field`,
      );
      assert.equal(
        body.includes("settingsDiscoveryWebhookSecret"),
        false,
        `${name} must not read the drawer-owned webhook secret field`,
      );
      assert.equal(
        body.includes("discoveryWebhookUrl"),
        false,
        `${name} must not carry the discoveryWebhookUrl override key`,
      );
      assert.equal(
        body.includes("discoveryWebhookSecret"),
        false,
        `${name} must not carry the discoveryWebhookSecret override key`,
      );
    }
  });

  it("a Settings save never writes a discovery key even when the drawer fields exist", async () => {
    const patches = [];
    const els = new Map();
    for (const id of [
      "settingsFormError",
      "settingsSheetId",
      "settingsOAuthClientId",
      "settingsTitle",
      "settingsResumeProvider",
      "settingsDiscoveryWebhookUrl",
      "settingsDiscoveryWebhookSecret",
    ]) {
      els.set(id, makeEl());
    }
    els.get("settingsSheetId").value = "1AbCdEfGhIjKlMnOpQrStUvWxYz012345";
    els.get("settingsResumeProvider").value = "gemini";
    els.get("settingsDiscoveryWebhookUrl").value = "https://evil.example/hook";
    els.get("settingsDiscoveryWebhookSecret").value = "clobber";
    const window = {
      JobBoredApp: {
        settings: {},
        configCore: { getEffectiveConfig: () => ({}) },
        core: {
          host: {
            parseGoogleSheetId: (raw) => String(raw || "").trim() || null,
            normalizeDashboardTitle: (v) => String(v || "").trim(),
            readStoredConfigOverrides: () => ({}),
            mergeStoredConfigOverridePatch: (p) => {
              patches.push({ ...p });
              return p;
            },
            resolveGeminiModel: () => "gemini-flash",
            renderAppsScriptDeployUi() {},
            setSHEET_ID() {},
            setDashboardSheetLinks() {},
            syncDiscoveryButtonState() {},
            applyOAuthClientChange: () => true,
            showToast() {},
          },
        },
      },
      JobBoredSettingsTabs: { activateTabForField() {} },
      JobBoredModelCatalog: { DEFAULT_MODEL_BY_PROVIDER: { ...EXPECTED_DEFAULTS } },
      COMMAND_CENTER_CONFIG: {},
      location: { reload() {} },
    };
    const document = {
      readyState: "loading",
      getElementById: (id) => (els.has(id) ? els.get(id) : null),
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener() {},
      createElement: () => makeEl(),
    };
    const ctx = vm.createContext({
      window,
      document,
      console,
      setTimeout: () => 0,
      clearTimeout() {},
      URL,
      JSON,
      Promise,
      Object,
      String,
      Array,
      requestAnimationFrame: (fn) => fn(),
    });
    vm.runInContext(settingsModalJs, ctx, { filename: "settings-modal.js" });
    await window.JobBoredApp.settings.saveCommandCenterSettingsFromForm();
    assert.ok(patches.length >= 1, "the save must merge a patch");
    for (const patch of patches) {
      assert.equal(
        Object.prototype.hasOwnProperty.call(patch, "discoveryWebhookUrl"),
        false,
      );
      assert.equal(
        Object.prototype.hasOwnProperty.call(patch, "discoveryWebhookSecret"),
        false,
      );
    }
  });
});

describe("D5 · one default-model table, two consumers", () => {
  function loadCatalog() {
    const window = {};
    const ctx = vm.createContext({
      window,
      console,
      fetch: async () => ({ ok: false, status: 404 }),
      localStorage: {
        getItem: () => null,
        setItem() {},
        removeItem() {},
      },
      Date,
    });
    vm.runInContext(modelCatalogJs, ctx, { filename: "model-catalog.js" });
    return window.JobBoredModelCatalog;
  }

  it("model-catalog.js exports DEFAULT_MODEL_BY_PROVIDER with the beat's ids", () => {
    const catalog = loadCatalog();
    assert.ok(catalog.DEFAULT_MODEL_BY_PROVIDER, "the table must be exported");
    assert.deepEqual(plain(catalog.DEFAULT_MODEL_BY_PROVIDER), EXPECTED_DEFAULTS);
  });

  it("keys the table by a supported provider id, with a non-empty model each", () => {
    const catalog = loadCatalog();
    for (const [provider, model] of Object.entries(
      catalog.DEFAULT_MODEL_BY_PROVIDER,
    )) {
      assert.ok(
        catalog.getStaticModels(provider).length > 0,
        `${provider} must be a provider the catalog supports`,
      );
      assert.ok(
        typeof model === "string" && model.trim().length > 0,
        `${provider} needs a non-empty default model`,
      );
    }
  });

  it("oneflow-beat-ai.js hard-codes no provider default model", () => {
    for (const model of Object.values(EXPECTED_DEFAULTS)) {
      assert.equal(
        oneflowBeatAiJs.includes(`defaultModel: "${model}"`),
        false,
        `oneflow-beat-ai.js still hard-codes ${model} — it must read the catalog table`,
      );
    }
    assert.match(oneflowBeatAiJs, /DEFAULT_MODEL_BY_PROVIDER/);
  });

  it("settings-modal.js hard-codes no provider default model", () => {
    for (const stale of ["gpt-4o-mini", "claude-sonnet-4-6"]) {
      assert.equal(
        settingsModalJs.includes(stale),
        false,
        `settings-modal.js still carries the stale default ${stale}`,
      );
    }
    assert.match(settingsModalJs, /DEFAULT_MODEL_BY_PROVIDER/);
  });

  it("the Settings save writes the catalog default when a model field is blank", async () => {
    const patches = [];
    const els = new Map();
    for (const id of [
      "settingsFormError",
      "settingsSheetId",
      "settingsOAuthClientId",
      "settingsTitle",
      "settingsResumeProvider",
      "settingsResumeOpenAIApiKey",
      "settingsResumeOpenAIModel",
      "settingsResumeAnthropicModel",
    ]) {
      els.set(id, makeEl());
    }
    els.get("settingsSheetId").value = "1AbCdEfGhIjKlMnOpQrStUvWxYz012345";
    els.get("settingsResumeProvider").value = "openai";
    const window = {
      JobBoredApp: {
        settings: {},
        configCore: { getEffectiveConfig: () => ({}) },
        core: {
          host: {
            parseGoogleSheetId: (raw) => String(raw || "").trim() || null,
            normalizeDashboardTitle: (v) => String(v || "").trim(),
            readStoredConfigOverrides: () => ({}),
            mergeStoredConfigOverridePatch: (p) => {
              patches.push({ ...p });
              return p;
            },
            resolveGeminiModel: () => "gemini-flash",
            renderAppsScriptDeployUi() {},
            setSHEET_ID() {},
            setDashboardSheetLinks() {},
            syncDiscoveryButtonState() {},
            applyOAuthClientChange: () => true,
            showToast() {},
          },
        },
      },
      JobBoredSettingsTabs: { activateTabForField() {} },
      JobBoredModelCatalog: { DEFAULT_MODEL_BY_PROVIDER: { ...EXPECTED_DEFAULTS } },
      COMMAND_CENTER_CONFIG: {},
      location: { reload() {} },
    };
    const document = {
      readyState: "loading",
      getElementById: (id) => (els.has(id) ? els.get(id) : null),
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener() {},
      createElement: () => makeEl(),
    };
    const ctx = vm.createContext({
      window,
      document,
      console,
      setTimeout: () => 0,
      clearTimeout() {},
      URL,
      JSON,
      Promise,
      Object,
      String,
      Array,
      requestAnimationFrame: (fn) => fn(),
    });
    vm.runInContext(settingsModalJs, ctx, { filename: "settings-modal.js" });
    await window.JobBoredApp.settings.saveCommandCenterSettingsFromForm();
    const merged = Object.assign({}, ...patches);
    assert.equal(merged.resumeOpenAIModel, "gpt-5.6-terra");
    assert.equal(merged.resumeAnthropicModel, "claude-sonnet-5");
  });
});
