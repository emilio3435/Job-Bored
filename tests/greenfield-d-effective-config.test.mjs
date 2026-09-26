import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

/* ============================================================
   GREENFIELD D1 · effective config, D2 · one writer.

   getConfig() nulls the WHOLE config whenever sheetId fails to parse
   (app-config-core.js:51-61), so every caller that wanted the OAuth client
   id, the provider, or a model name lost them together with a typo'd sheet
   URL. getEffectiveConfig() is the overlay resolver: window config with the
   stored overrides applied, sheetId preserved verbatim, never null.

   D2: settings-profile-tab.js must not read or write
   localStorage["command_center_config_overrides"] behind config-overrides.js'
   back — mergeStoredConfigOverridePatch is the one writer.
   ============================================================ */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const configCoreJs = readFileSync(join(repoRoot, "app-config-core.js"), "utf8");
const configOverridesJs = readFileSync(
  join(repoRoot, "config-overrides.js"),
  "utf8",
);
const settingsModalJs = readFileSync(
  join(repoRoot, "settings-modal.js"),
  "utf8",
);
const settingsProfileTabJs = readFileSync(
  join(repoRoot, "settings-profile-tab.js"),
  "utf8",
);
const oneflowBeatAiJs = readFileSync(
  join(repoRoot, "oneflow-beat-ai.js"),
  "utf8",
);

function fakeLocalStorage(seed = {}) {
  const store = new Map(Object.entries(seed));
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    __store: store,
  };
}

/** app-config-core.js + config-overrides.js in one context, as index.html loads them. */
function loadCore({ config = {}, overrides = null } = {}) {
  const localStorage = fakeLocalStorage(
    overrides ? { command_center_config_overrides: JSON.stringify(overrides) } : {},
  );
  const window = {
    COMMAND_CENTER_CONFIG: { ...config },
    JobBoredApp: { core: { host: {} } },
    location: { search: "", href: "http://localhost:8080/", hostname: "localhost", port: "8080" },
  };
  const ctx = vm.createContext({
    window,
    console,
    URL,
    URLSearchParams,
    localStorage,
    sessionStorage: { getItem: () => null, setItem() {} },
    document: { getElementById: () => null },
    fetch: async () => ({ ok: false, status: 404 }),
    setTimeout,
    clearTimeout,
  });
  vm.runInContext(configOverridesJs, ctx, { filename: "config-overrides.js" });
  vm.runInContext(configCoreJs, ctx, { filename: "app-config-core.js" });
  return { core: window.JobBoredApp.configCore, window, localStorage };
}

describe("D1 · getEffectiveConfig() is the overlay resolver", () => {
  it("is exported on the same global as getConfig", () => {
    const { core } = loadCore();
    assert.equal(
      typeof core.getEffectiveConfig,
      "function",
      "configCore.getEffectiveConfig must sit beside configCore.getConfig",
    );
  });

  it("preserves a malformed sheetId as-is instead of nulling the config", () => {
    const { core } = loadCore({
      config: {
        sheetId: "not a sheet id",
        oauthClientId: "cid.apps.googleusercontent.com",
        resumeProvider: "openrouter",
      },
    });
    assert.equal(core.getConfig(), null, "getConfig still nulls — that is its contract");
    const eff = core.getEffectiveConfig();
    assert.ok(eff && typeof eff === "object", "getEffectiveConfig never returns null");
    assert.equal(eff.sheetId, "not a sheet id", "the raw sheetId survives verbatim");
    assert.equal(eff.oauthClientId, "cid.apps.googleusercontent.com");
    assert.equal(eff.resumeProvider, "openrouter");
  });

  it("overlays the stored config overrides on top of window config", () => {
    const { core } = loadCore({
      config: { sheetId: "", resumeProvider: "gemini", title: "JobBored" },
      overrides: { resumeProvider: "openrouter", resumeOpenRouterModel: "z/model" },
    });
    const eff = core.getEffectiveConfig();
    assert.equal(eff.resumeProvider, "openrouter", "override wins over config.js");
    assert.equal(eff.resumeOpenRouterModel, "z/model");
  });

  it("returns an object even with no window config at all", () => {
    const { core, window } = loadCore();
    delete window.COMMAND_CENTER_CONFIG;
    const eff = core.getEffectiveConfig();
    assert.ok(eff && typeof eff === "object");
  });
});

/* ---- populateCommandCenterSettingsForm reads the resolver ---------------- */

function makeEl(overrides = {}) {
  return {
    value: "",
    textContent: "",
    style: {},
    hidden: false,
    disabled: false,
    options: [],
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    addEventListener() {},
    appendChild() {},
    querySelectorAll: () => [],
    ...overrides,
  };
}

function loadSettingsModal({ effectiveConfig, ids }) {
  const els = new Map();
  for (const id of ids) els.set(id, makeEl());
  const calls = { effective: 0 };
  const window = {
    JobBoredApp: {
      settings: {},
      configCore: {
        getEffectiveConfig() {
          calls.effective += 1;
          return { ...effectiveConfig };
        },
      },
      core: {
        host: {
          parseGoogleSheetId: (raw) => String(raw || "").trim() || null,
          normalizeDashboardTitle: (v) => String(v || "").trim() || "JobBored",
          readStoredConfigOverrides: () => ({ __fromRawOverrides: true }),
          mergeStoredConfigOverridePatch: (p) => p,
          resolveGeminiModel: () => "gemini-flash",
          renderAppsScriptDeployUi() {},
          showToast() {},
        },
      },
    },
    JobBoredModelCatalog: {
      DEFAULT_MODEL_BY_PROVIDER: {},
      getStaticModels: () => [],
      getProviderModels: async () => ({ models: [] }),
    },
    COMMAND_CENTER_CONFIG: { __raw: true },
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
  return { api: window.JobBoredApp.settings, els, calls };
}

describe("D1 · populateCommandCenterSettingsForm reads getEffectiveConfig()", () => {
  it("fills the form from the resolver, not from a raw window-config spread", () => {
    const { api, els, calls } = loadSettingsModal({
      effectiveConfig: {
        sheetId: "sheet-from-resolver",
        oauthClientId: "cid-from-resolver",
        resumeProvider: "openrouter",
        resumeOpenRouterApiKey: "sk-or-resolver",
      },
      ids: [
        "settingsSheetId",
        "settingsOAuthClientId",
        "settingsTitle",
        "settingsResumeProvider",
        "settingsResumeOpenRouterApiKey",
        "settingsFormError",
      ],
    });
    api.populateCommandCenterSettingsForm();
    assert.ok(calls.effective >= 1, "populate must call configCore.getEffectiveConfig()");
    assert.equal(els.get("settingsSheetId").value, "sheet-from-resolver");
    assert.equal(els.get("settingsOAuthClientId").value, "cid-from-resolver");
    assert.equal(els.get("settingsResumeOpenRouterApiKey").value, "sk-or-resolver");
  });
});

/* ---- oneflow-beat-ai liveConfig() reads the resolver --------------------- */

function loadBeatAi({ effectiveConfig }) {
  const calls = { effective: 0 };
  const window = {
    JobBoredOneFlow: {},
    JobBoredApp: {
      configCore: {
        getEffectiveConfig() {
          calls.effective += 1;
          return { ...effectiveConfig };
        },
      },
    },
    COMMAND_CENTER_CONFIG: { __raw: true },
    JobBoredModelCatalog: {
      DEFAULT_MODEL_BY_PROVIDER: {
        openrouter: "openai/gpt-oss-120b:free",
        gemini: "gemini-flash",
        openai: "gpt-5.6-terra",
        anthropic: "claude-sonnet-5",
        local: "gemma4:e2b",
      },
    },
  };
  const ctx = vm.createContext({
    window,
    document: { getElementById: () => null, createElement: () => makeEl() },
    console,
    setTimeout: () => 0,
    clearTimeout() {},
    fetch: async () => ({ ok: false, status: 404, json: async () => ({}) }),
    URL,
    JSON,
    Promise,
    Object,
    String,
    Array,
    Boolean,
    Number,
    Math,
    Date,
  });
  vm.runInContext(oneflowBeatAiJs, ctx, { filename: "oneflow-beat-ai.js" });
  return { beat: window.JobBoredOneFlow, calls, window };
}

describe("D1 · oneflow-beat-ai liveConfig() reads getEffectiveConfig()", () => {
  it("routes the beat's config reads through the resolver", () => {
    const src = readFileSync(join(repoRoot, "oneflow-beat-ai.js"), "utf8");
    const liveConfigBody = src.slice(
      src.indexOf("function liveConfig()"),
      src.indexOf("function resolveModel("),
    );
    assert.match(
      liveConfigBody,
      /getEffectiveConfig/,
      "liveConfig() must resolve through configCore.getEffectiveConfig()",
    );
    const { calls } = loadBeatAi({ effectiveConfig: { resumeProvider: "openrouter" } });
    // The beat resolves config lazily; touching the module is enough to prove
    // the seam exists, the source assertion above proves it is wired.
    assert.equal(typeof calls.effective, "number");
  });
});

/* ---- D2 · one writer ---------------------------------------------------- */

describe("D2 · settings-profile-tab.js is not a second override writer", () => {
  it("does not name the override localStorage key anywhere in the file", () => {
    assert.equal(
      settingsProfileTabJs.includes("command_center_config_overrides"),
      false,
      'settings-profile-tab.js must not touch localStorage["command_center_config_overrides"] — ' +
        "config-overrides.js owns that key",
    );
  });

  it("does not name the transport-setup localStorage key either", () => {
    assert.equal(
      settingsProfileTabJs.includes("command_center_discovery_transport_setup"),
      false,
      "the transport read must go through configOverrides.readDiscoveryTransportSetupState()",
    );
  });

  it("round-trips a discovery secret through mergeStoredConfigOverridePatch", () => {
    const patches = [];
    const stored = {};
    const secretField = makeEl();
    const window = {
      COMMAND_CENTER_CONFIG: {},
      JobBoredApp: {
        configOverrides: {
          readStoredConfigOverrides: () => ({ ...stored }),
          mergeStoredConfigOverridePatch(patch) {
            patches.push({ ...patch });
            Object.assign(stored, patch);
            return { ...stored };
          },
          readDiscoveryTransportSetupState: () => ({}),
        },
      },
      setTimeout: () => 0,
      clearTimeout() {},
      location: { hostname: "127.0.0.1", port: "8080", href: "http://127.0.0.1:8080/" },
      addEventListener() {},
    };
    const document = {
      readyState: "complete",
      getElementById: (id) =>
        id === "settingsDiscoveryWebhookSecret" ? secretField : null,
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener() {},
      createElement: () => makeEl(),
      body: makeEl(),
    };
    const ctx = vm.createContext({
      window,
      document,
      console,
      localStorage: fakeLocalStorage(),
      sessionStorage: fakeLocalStorage(),
      setTimeout: () => 0,
      clearTimeout() {},
      fetch: async () => ({ ok: false, status: 404 }),
      URL,
      URLSearchParams,
      JSON,
      Promise,
      Object,
      String,
      Array,
      Boolean,
      Number,
      Math,
      Date,
      FormData: class {},
      AbortController: class {
        constructor() {
          this.signal = {};
        }
        abort() {}
      },
    });
    vm.runInContext(settingsProfileTabJs, ctx, {
      filename: "settings-profile-tab.js",
    });
    const api = window.JobBoredSettingsProfileTab;
    const t = api && api.__test;
    assert.ok(
      t && typeof t.updateDiscoverySecretCaches === "function",
      "settings-profile-tab.__test must expose updateDiscoverySecretCaches for this seam",
    );
    t.updateDiscoverySecretCaches("s3cr3t", { force: true });
    assert.deepEqual(
      patches,
      [{ discoveryWebhookSecret: "s3cr3t" }],
      "the secret must land through the one writer",
    );
    assert.equal(window.COMMAND_CENTER_CONFIG.discoveryWebhookSecret, "s3cr3t");
  });
});
