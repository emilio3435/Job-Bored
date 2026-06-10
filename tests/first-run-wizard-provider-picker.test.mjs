import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

/* ============================================================
   First-run wizard — full provider picker + live "Check connection".

   The OSS first-run AI provider step used to only offer
   OpenRouter / Local. This raises it to the same provider set
   the Settings → AI Providers tab carries — gemini, openai,
   anthropic, openrouter, local, webhook — with:
     - a provider PILL ROW (radio-backed, mirroring the existing
       OpenRouter/Local pattern)
     - ONE per-provider sub-panel that switches with selection
     - a per-provider key field (plus baseUrl for local, webhook
       URL for webhook)
     - a LIVE "Check connection" button that calls
       window.JobBoredModelCatalog.pingProvider and surfaces the
       result inline (✓ Connected / ✗ explanation)
     - a SELF-UPDATING model dropdown populated via
       window.JobBoredModelCatalog.getProviderModels (live when a
       key is present; static fallback otherwise)
     - persistence via mergeStoredConfigOverridePatch only — keys
       used must be on COMMAND_CENTER_OVERRIDE_KEYS already.

   Tests inject a stub catalog via firstRunWizard.__setCatalog so
   no real network is touched.
   ============================================================ */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const firstRunPartial = readFileSync(
  join(repoRoot, "partials", "first-run-wizard.html"),
  "utf8",
);
const firstRunWizardJs = readFileSync(
  join(repoRoot, "first-run-wizard.js"),
  "utf8",
);
const configOverridesJs = readFileSync(
  join(repoRoot, "config-overrides.js"),
  "utf8",
);

// --- Minimal DOM stub that records innerHTML + listeners ---
function makeFakeEl(id) {
  const el = {
    id,
    style: {},
    dataset: {},
    hidden: false,
    disabled: false,
    value: "",
    textContent: "",
    className: "",
    innerHTML: "",
    checked: false,
    title: "",
    children: [],
    classList: {
      add() {},
      remove() {},
      toggle() {},
      contains() {
        return false;
      },
    },
    _listeners: {},
    addEventListener(type, fn) {
      (this._listeners[type] = this._listeners[type] || []).push(fn);
    },
    removeEventListener() {},
    setAttribute() {},
    removeAttribute() {},
    getAttribute() {
      return null;
    },
    appendChild(child) {
      this.children.push(child);
    },
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
    closest() {
      return null;
    },
    focus() {},
    __fire(type, ev) {
      (this._listeners[type] || []).forEach((fn) => fn(ev || {}));
    },
  };
  return el;
}

function makeFakeDocument() {
  const els = new Map();
  const docListeners = {};
  return {
    readyState: "complete",
    body: makeFakeEl("body"),
    getElementById(id) {
      if (!els.has(id)) els.set(id, makeFakeEl(id));
      return els.get(id);
    },
    querySelector(sel) {
      // very narrow: the wizard's only querySelector is for the radio group +
      // the subtitle string. Returning null is correct for both in test.
      if (
        typeof sel === "string" &&
        sel.includes('input[name="firstRunProvider"]:checked')
      ) {
        for (const el of els.values()) {
          if (
            el &&
            el.id &&
            el.id.startsWith("firstRunProvider") &&
            el.checked
          ) {
            return el;
          }
        }
        return null;
      }
      return null;
    },
    querySelectorAll() {
      return [];
    },
    addEventListener(type, fn) {
      (docListeners[type] = docListeners[type] || []).push(fn);
    },
    createElement() {
      return makeFakeEl("created");
    },
    __fireDoc(type, ev) {
      (docListeners[type] || []).forEach((fn) => fn(ev || {}));
    },
  };
}

function loadWizard(hostStub) {
  const window = {
    JobBoredApp: { core: { host: hostStub || {} } },
    COMMAND_CENTER_CONFIG: {},
  };
  const document = makeFakeDocument();
  const ctx = {
    window,
    document,
    console: { log() {}, warn() {}, error() {} },
    setTimeout,
    setInterval: () => 0,
    clearInterval: () => {},
    requestAnimationFrame: (fn) => fn(),
  };
  vm.createContext(ctx);
  vm.runInContext(firstRunWizardJs, ctx, { filename: "first-run-wizard.js" });
  return { api: window.JobBoredApp.firstRunWizard, window, document };
}

function loadConfigOverrides(initialStore = {}) {
  const store = new Map(Object.entries(initialStore));
  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  const window = { JobBoredApp: {}, COMMAND_CENTER_CONFIG: {} };
  const ctx = {
    window,
    localStorage,
    console: { log() {}, warn() {}, error() {} },
    document: { getElementById: () => null },
  };
  vm.createContext(ctx);
  vm.runInContext(configOverridesJs, ctx, { filename: "config-overrides.js" });
  return { api: window.JobBoredApp.configOverrides, window };
}

describe("first-run wizard partial — full provider pill row", () => {
  it("provider step exposes pills for every supported provider", () => {
    for (const id of [
      "firstRunProviderOpenRouter",
      "firstRunProviderLocal",
      "firstRunProviderGemini",
      "firstRunProviderOpenAI",
      "firstRunProviderAnthropic",
      "firstRunProviderWebhook",
    ]) {
      assert.ok(
        firstRunPartial.includes(`id="${id}"`),
        `provider step must define ${id} so the user can pick from the full set in the wizard`,
      );
    }
  });

  it("each provider sub-panel exists with a per-provider key/url field", () => {
    const pairs = [
      // OpenRouter and Local already existed; keep them in the same model so the
      // step has one consistent shell for all providers.
      [
        "firstRunProviderPanelOpenRouter",
        "firstRunOpenRouterKeyInput",
      ],
      ["firstRunProviderPanelLocal", "firstRunLocalModelSelect"],
      ["firstRunProviderPanelGemini", "firstRunGeminiKeyInput"],
      ["firstRunProviderPanelOpenAI", "firstRunOpenAIKeyInput"],
      ["firstRunProviderPanelAnthropic", "firstRunAnthropicKeyInput"],
      ["firstRunProviderPanelWebhook", "firstRunWebhookUrlInput"],
    ];
    for (const [panelId, fieldId] of pairs) {
      assert.ok(
        firstRunPartial.includes(`id="${panelId}"`),
        `provider step must define ${panelId}`,
      );
      assert.ok(
        firstRunPartial.includes(`id="${fieldId}"`),
        `${panelId} must contain a key/url field id="${fieldId}"`,
      );
    }
  });

  it("each key-based provider has a live model select", () => {
    for (const id of [
      "firstRunOpenRouterModelSelect",
      "firstRunGeminiModelSelect",
      "firstRunOpenAIModelSelect",
      "firstRunAnthropicModelSelect",
      "firstRunLocalModelSelect",
    ]) {
      assert.ok(
        firstRunPartial.includes(`id="${id}"`),
        `provider step must expose ${id} so the model dropdown is self-updating`,
      );
    }
  });

  it("each provider sub-panel has a 'Check connection' button + status line", () => {
    const buttons = [
      "firstRunOpenRouterCheckBtn",
      "firstRunGeminiCheckBtn",
      "firstRunOpenAICheckBtn",
      "firstRunAnthropicCheckBtn",
      "firstRunLocalCheckBtn",
    ];
    for (const id of buttons) {
      assert.ok(
        firstRunPartial.includes(`id="${id}"`),
        `provider step must define a check-connection button id="${id}"`,
      );
    }
    for (const id of [
      "firstRunOpenRouterCheckStatus",
      "firstRunGeminiCheckStatus",
      "firstRunOpenAICheckStatus",
      "firstRunAnthropicCheckStatus",
      "firstRunLocalCheckStatus",
    ]) {
      assert.ok(
        firstRunPartial.includes(`id="${id}"`),
        `provider step must define a status line id="${id}" for the live check result`,
      );
    }
  });

  it("step copy reflects that the picker covers ALL providers (no 'add later in Settings' restriction)", () => {
    // The old copy said key providers can be added later in Settings. With the
    // wizard now covering the same provider set as Settings, that disclaimer
    // is removed so the step is the canonical entry surface.
    assert.ok(
      !/can be added\s+later in Settings/.test(firstRunPartial),
      "the wizard now covers every provider — the 'added later in Settings' disclaimer should be gone",
    );
  });
});

describe("first-run wizard module — provider picker API surface", () => {
  it("exposes the full provider helper set (no test-only seam needed)", () => {
    const { api } = loadWizard({
      getSheetId: () => "sheet",
      isSignedIn: () => true,
      getResumeGenerate: () => ({
        isResumeGenerationConfigured: () => false,
        getResumeGenerationConfig: () => ({ provider: "openrouter" }),
      }),
    });
    for (const fn of [
      "firstRunSelectedProvider",
      "firstRunSelectProvider",
      "firstRunSaveProviderKey",
      "firstRunVerifyProvider",
      "firstRunRefreshModelsFor",
      "__setCatalog",
    ]) {
      assert.equal(
        typeof api[fn],
        "function",
        `firstRunWizard.${fn} should be a function`,
      );
    }
  });

  function seedProviderStepDom(document) {
    const radios = [
      ["OpenRouter", "openrouter"],
      ["Local", "local"],
      ["Gemini", "gemini"],
      ["OpenAI", "openai"],
      ["Anthropic", "anthropic"],
      ["Webhook", "webhook"],
    ];
    for (const [cap, value] of radios) {
      const radio = document.getElementById(`firstRunProvider${cap}`);
      radio.value = value;
    }
    for (const id of [
      "firstRunPanelSheet",
      "firstRunPanelProvider",
      "firstRunProviderPanelOpenRouter",
      "firstRunProviderPanelLocal",
      "firstRunProviderPanelGemini",
      "firstRunProviderPanelOpenAI",
      "firstRunProviderPanelAnthropic",
      "firstRunProviderPanelWebhook",
      "firstRunGeminiKeyInput",
      "firstRunLocalModelSelect",
      "firstRunLocalDownloadControl",
    ]) {
      document.getElementById(id);
    }
  }

  it("renderProviderStep is read-only hydration (never coerces resumeProvider)", () => {
    assert.ok(
      !/persistResumeProvider\(\s*["']openrouter["']\s*\)/.test(
        firstRunWizardJs,
      ),
      "renderProviderStep must not silently overwrite non-OpenRouter providers",
    );
  });

  it("revisiting the provider step must not reset a saved Gemini choice to OpenRouter", () => {
    const patches = [];
    const { api, document, window } = loadWizard({
      mergeStoredConfigOverridePatch: (patch) => patches.push(patch),
      getSheetId: () => "sheet-abc",
      isSignedIn: () => true,
      getResumeGenerate: () => ({
        isResumeGenerationConfigured: () => true,
        getResumeGenerationConfig: () => ({
          provider: "gemini",
          resumeGeminiApiKey: "AIza-saved-key",
        }),
      }),
    });
    seedProviderStepDom(document);
    window.COMMAND_CENTER_CONFIG.resumeProvider = "gemini";
    api.firstRunSelectProvider("gemini");
    patches.length = 0;
    api.setFirstRunStep(1);
    api.setFirstRunStep(2);
    assert.equal(
      patches.some((p) => p.resumeProvider === "openrouter"),
      false,
      "renderProviderStep must not coerce resumeProvider back to openrouter",
    );
    assert.equal(
      window.COMMAND_CENTER_CONFIG.resumeProvider,
      "gemini",
      "live config must keep the user's gemini provider",
    );
    assert.equal(
      document.getElementById("firstRunProviderGemini").checked,
      true,
      "gemini radio must stay selected when step 2 is re-shown",
    );
    assert.equal(
      document.getElementById("firstRunGeminiKeyInput").value,
      "AIza-saved-key",
      "saved gemini key must be hydrated into the input",
    );
  });

  it("firstRunSelectedProvider recognizes every provider (no openrouter/local-only collapse)", () => {
    const make = (provider) =>
      loadWizard({
        getSheetId: () => "sheet",
        isSignedIn: () => true,
        getResumeGenerate: () => ({
          isResumeGenerationConfigured: () => false,
          getResumeGenerationConfig: () => ({ provider }),
        }),
      }).api;
    for (const p of [
      "openrouter",
      "local",
      "gemini",
      "openai",
      "anthropic",
      "webhook",
    ]) {
      assert.equal(
        make(p).firstRunSelectedProvider(),
        p,
        `firstRunSelectedProvider should return ${p} when the config says so`,
      );
    }
  });

  it("firstRunSaveProviderKey persists the right override key for each provider", () => {
    const cases = [
      { provider: "openrouter", key: "sk-or-v1-abcd1234", field: "resumeOpenRouterApiKey" },
      { provider: "gemini", key: "AIza-test-1234", field: "resumeGeminiApiKey" },
      { provider: "openai", key: "sk-openai-test-1234", field: "resumeOpenAIApiKey" },
      { provider: "anthropic", key: "sk-ant-test-1234", field: "resumeAnthropicApiKey" },
    ];
    for (const { provider, key, field } of cases) {
      const patches = [];
      const { api, window } = loadWizard({
        mergeStoredConfigOverridePatch: (patch) => patches.push(patch),
        getSheetId: () => "sheet",
        isSignedIn: () => true,
        getResumeGenerate: () => ({
          isResumeGenerationConfigured: () => false,
          getResumeGenerationConfig: () => ({ provider }),
        }),
      });
      window.COMMAND_CENTER_CONFIG = {};
      const res = api.firstRunSaveProviderKey(provider, key);
      assert.equal(res.ok, true, `${provider} save should succeed: ${JSON.stringify(res)}`);
      assert.ok(
        patches.some((p) => p[field] === key),
        `${provider} save must persist ${field} via mergeStoredConfigOverridePatch — patches=${JSON.stringify(patches)}`,
      );
      assert.equal(window.COMMAND_CENTER_CONFIG[field], key);
    }
  });

  it("firstRunSaveProviderKey for webhook persists resumeGenerationWebhookUrl", () => {
    const patches = [];
    const { api, window } = loadWizard({
      mergeStoredConfigOverridePatch: (patch) => patches.push(patch),
      getSheetId: () => "sheet",
      isSignedIn: () => true,
      getResumeGenerate: () => ({
        isResumeGenerationConfigured: () => false,
        getResumeGenerationConfig: () => ({ provider: "webhook" }),
      }),
    });
    window.COMMAND_CENTER_CONFIG = {};
    const res = api.firstRunSaveProviderKey(
      "webhook",
      "https://my-server.example/resume",
    );
    assert.equal(res.ok, true);
    assert.ok(
      patches.some(
        (p) => p.resumeGenerationWebhookUrl === "https://my-server.example/resume",
      ),
      "webhook save must persist resumeGenerationWebhookUrl",
    );
  });

  it("firstRunVerifyProvider calls JobBoredModelCatalog.pingProvider and renders the status", async () => {
    const { api, document } = loadWizard({
      getSheetId: () => "sheet",
      isSignedIn: () => true,
      getResumeGenerate: () => ({
        isResumeGenerationConfigured: () => false,
        getResumeGenerationConfig: () => ({
          provider: "openrouter",
          resumeOpenRouterApiKey: "sk-or-v1-stub",
        }),
      }),
    });
    let pingArgs = null;
    api.__setCatalog({
      pingProvider: async (args) => {
        pingArgs = args;
        return { ok: true, status: 200, message: "Connected." };
      },
      getProviderModels: async () => ({
        models: [{ value: "openai/gpt-oss-120b:free", label: "Free" }],
        source: "live",
      }),
    });
    const status = document.getElementById("firstRunOpenRouterCheckStatus");
    await api.firstRunVerifyProvider("openrouter");
    assert.ok(pingArgs, "pingProvider should be called");
    assert.equal(pingArgs.provider, "openrouter");
    assert.equal(pingArgs.apiKey, "sk-or-v1-stub");
    assert.equal(status.hidden, false, "status line should be visible after a check");
    assert.match(
      status.textContent,
      /connect/i,
      "status should mention connected",
    );
  });

  it("firstRunVerifyProvider surfaces failures (401) with a clear error class", async () => {
    const { api, document } = loadWizard({
      getSheetId: () => "sheet",
      isSignedIn: () => true,
      getResumeGenerate: () => ({
        isResumeGenerationConfigured: () => false,
        getResumeGenerationConfig: () => ({
          provider: "anthropic",
          resumeAnthropicApiKey: "sk-ant-bogus",
        }),
      }),
    });
    let classToggled = false;
    const status = document.getElementById("firstRunAnthropicCheckStatus");
    status.classList.toggle = (cls, on) => {
      if (cls === "first-run-status--error" && on === true) classToggled = true;
    };
    api.__setCatalog({
      pingProvider: async () => ({
        ok: false,
        status: 401,
        message: "Invalid API key.",
      }),
      getProviderModels: async () => ({ models: [], source: "static" }),
    });
    await api.firstRunVerifyProvider("anthropic");
    assert.equal(
      classToggled,
      true,
      "failed verification must mark the status line with the error class",
    );
    assert.match(status.textContent, /invalid|key|401|couldn/i);
  });

  it("firstRunRefreshModelsFor populates the per-provider model select via the catalog and persists the chosen model", async () => {
    const patches = [];
    const { api, document } = loadWizard({
      mergeStoredConfigOverridePatch: (patch) => patches.push(patch),
      getSheetId: () => "sheet",
      isSignedIn: () => true,
      getResumeGenerate: () => ({
        isResumeGenerationConfigured: () => false,
        getResumeGenerationConfig: () => ({
          provider: "anthropic",
          resumeAnthropicApiKey: "sk-ant-good",
          resumeAnthropicModel: "claude-opus-4-8",
        }),
      }),
    });
    api.__setCatalog({
      pingProvider: async () => ({ ok: true, status: 200, message: "" }),
      getProviderModels: async ({ provider }) => {
        assert.equal(provider, "anthropic");
        return {
          models: [
            { value: "claude-opus-4-8", label: "Claude Opus 4.8" },
            { value: "claude-fable-5", label: "Claude Fable 5" },
          ],
          source: "live",
        };
      },
    });
    const sel = document.getElementById("firstRunAnthropicModelSelect");
    // Stub document.createElement so appendChild registers values we can read.
    const createdOptions = [];
    sel.appendChild = (opt) => {
      createdOptions.push(opt);
      sel.children.push(opt);
    };
    document.createElement = (tag) => {
      const el = makeFakeEl(tag);
      return el;
    };
    await api.firstRunRefreshModelsFor("anthropic");
    const values = createdOptions.map((o) => o.value);
    assert.ok(
      values.includes("claude-opus-4-8") && values.includes("claude-fable-5"),
      "model select must be populated with the catalog's results",
    );
  });

  it("the catalog is consulted only when a key is present (no useless network for blank fields)", async () => {
    const { api } = loadWizard({
      getSheetId: () => "sheet",
      isSignedIn: () => true,
      getResumeGenerate: () => ({
        isResumeGenerationConfigured: () => false,
        getResumeGenerationConfig: () => ({
          provider: "openai",
          resumeOpenAIApiKey: "",
        }),
      }),
    });
    let pinged = false;
    api.__setCatalog({
      pingProvider: async () => {
        pinged = true;
        return { ok: true, status: 200, message: "" };
      },
      getProviderModels: async () => ({ models: [], source: "static" }),
    });
    const res = await api.firstRunVerifyProvider("openai");
    assert.equal(pinged, false, "no ping when there is no key");
    assert.equal(res.ok, false);
    assert.match(res.message, /key/i);
  });
});

describe("first-run wizard module — wiring + persistence parity with Settings", () => {
  it("the wizard references mergeStoredConfigOverridePatch for every provider it touches", () => {
    for (const field of [
      "resumeProvider",
      "resumeOpenRouterApiKey",
      "resumeGeminiApiKey",
      "resumeOpenAIApiKey",
      "resumeAnthropicApiKey",
      "resumeGenerationWebhookUrl",
    ]) {
      assert.ok(
        firstRunWizardJs.includes(field),
        `first-run-wizard.js should write ${field} so all providers persist`,
      );
    }
  });

  it("every override key the wizard persists is already on COMMAND_CENTER_OVERRIDE_KEYS", () => {
    const { api } = loadConfigOverrides();
    for (const field of [
      "resumeProvider",
      "resumeOpenRouterApiKey",
      "resumeOpenRouterModel",
      "resumeGeminiApiKey",
      "resumeGeminiModel",
      "resumeOpenAIApiKey",
      "resumeOpenAIModel",
      "resumeAnthropicApiKey",
      "resumeAnthropicModel",
      "resumeLocalBaseUrl",
      "resumeLocalModel",
      "resumeGenerationWebhookUrl",
    ]) {
      assert.ok(
        api.COMMAND_CENTER_OVERRIDE_KEYS.includes(field),
        `${field} MUST be on the allowlist or the wizard's save will silently drop it`,
      );
    }
  });

  it("the wizard reads JobBoredModelCatalog (not a direct provider fetch in the wizard file itself)", () => {
    assert.ok(
      firstRunWizardJs.includes("JobBoredModelCatalog"),
      "first-run-wizard.js should consume the catalog rather than hand-rolling provider fetches",
    );
    // The wizard must NOT direct-fetch provider endpoints — those live in the
    // shared catalog so Settings can reuse them.
    assert.ok(
      !/generativelanguage\.googleapis\.com/.test(firstRunWizardJs),
      "the wizard should not hardcode provider URLs — those live in model-catalog.js",
    );
    assert.ok(
      !/api\.anthropic\.com/.test(firstRunWizardJs),
      "the wizard should not hardcode provider URLs — those live in model-catalog.js",
    );
  });
});
