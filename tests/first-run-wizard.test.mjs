import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { readIndexHtml } from "../scripts/lib/expand-index-includes.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const userContentStoreJs = readFileSync(
  join(repoRoot, "user-content-store.js"),
  "utf8",
);
const statusHandoffJs = readFileSync(
  join(repoRoot, "discovery-status-handoff.js"),
  "utf8",
);
const firstRunWizardJs = readFileSync(
  join(repoRoot, "first-run-wizard.js"),
  "utf8",
);
const appCompatJs = readFileSync(join(repoRoot, "app-compat.js"), "utf8");
const appJs = readFileSync(join(repoRoot, "app.js"), "utf8");
const resumeGenerationJs = readFileSync(
  join(repoRoot, "resume-generation.js"),
  "utf8",
);
const bridgeRegistryJs = readFileSync(
  join(repoRoot, "bridge-registry.js"),
  "utf8",
);
const appBootstrapJs = readFileSync(join(repoRoot, "app-bootstrap.js"), "utf8");
const configOverridesJs = readFileSync(
  join(repoRoot, "config-overrides.js"),
  "utf8",
);
const materialsFeatureJs = readFileSync(
  join(repoRoot, "materials-feature.js"),
  "utf8",
);
const settingsTabSchemaJs = readFileSync(
  join(repoRoot, "settings-tab-schema.js"),
  "utf8",
);
const settingsModalHtml = readFileSync(
  join(repoRoot, "partials", "settings-modal.html"),
  "utf8",
);
const firstRunPartial = readFileSync(
  join(repoRoot, "partials", "first-run-wizard.html"),
  "utf8",
);
const firstRunWizardCss = readFileSync(
  join(repoRoot, "css", "legacy-first-run-wizard.css"),
  "utf8",
);
const indexHtml = readIndexHtml(repoRoot);

// --- Minimal DOM stubs so the IIFE can wire listeners under vm ---
function makeFakeEl() {
  return {
    style: {},
    dataset: {},
    hidden: false,
    disabled: false,
    value: "",
    textContent: "",
    className: "",
    classList: {
      add() {},
      remove() {},
      toggle() {},
      contains() {
        return false;
      },
    },
    addEventListener() {},
    removeEventListener() {},
    setAttribute() {},
    removeAttribute() {},
    getAttribute() {
      return null;
    },
    appendChild() {},
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
  };
}

function makeFakeDocument() {
  const els = new Map();
  return {
    readyState: "complete",
    getElementById(id) {
      if (!els.has(id)) els.set(id, makeFakeEl());
      return els.get(id);
    },
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
    addEventListener() {},
    createElement() {
      return makeFakeEl();
    },
  };
}

function loadWizard(hostStub) {
  const window = { JobBoredApp: { core: { host: hostStub || {} } } };
  const document = makeFakeDocument();
  const ctx = {
    window,
    document,
    console,
    setTimeout,
    requestAnimationFrame: (fn) => fn(),
  };
  vm.createContext(ctx);
  vm.runInContext(firstRunWizardJs, ctx, { filename: "first-run-wizard.js" });
  return { api: window.JobBoredApp.firstRunWizard, window, document };
}

describe("UserContent infraSetupComplete flag", () => {
  it("exposes isInfraSetupComplete/completeInfraSetup/resetInfraSetupCompletion", () => {
    for (const fn of [
      "isInfraSetupComplete",
      "completeInfraSetup",
      "resetInfraSetupCompletion",
    ]) {
      assert.ok(
        userContentStoreJs.includes(`async function ${fn}`) ||
          userContentStoreJs.includes(`function ${fn}`),
        `${fn} should exist in user-content-store.js`,
      );
    }
  });

  it("mirrors the onboarding helpers using the infraSetupComplete setting key", () => {
    assert.match(
      userContentStoreJs,
      /async function isInfraSetupComplete\(\)\s*\{\s*return !!\(await getSetting\("infraSetupComplete"\)\);/,
      "isInfraSetupComplete should read the infraSetupComplete setting",
    );
    assert.match(
      userContentStoreJs,
      /async function completeInfraSetup\(\)\s*\{\s*await setSetting\("infraSetupComplete", true\);/,
      "completeInfraSetup should set the infraSetupComplete setting true",
    );
    assert.match(
      userContentStoreJs,
      /async function resetInfraSetupCompletion\(\)\s*\{\s*await setSetting\("infraSetupComplete", false\);/,
      "resetInfraSetupCompletion should clear the infraSetupComplete setting",
    );
  });

  it("registers the new helpers on the public API surface", () => {
    for (const fn of [
      "isInfraSetupComplete",
      "completeInfraSetup",
      "resetInfraSetupCompletion",
    ]) {
      assert.ok(
        new RegExp(`\\n\\s*${fn},`).test(userContentStoreJs),
        `${fn} should be exported on window.CommandCenterUserContent`,
      );
    }
  });
});

describe("Infra setup gate ordering", () => {
  it("runPostAccessBootstrapOnce gates infra setup before checkOnboardingGate", () => {
    const start = statusHandoffJs.indexOf(
      "function runPostAccessBootstrapOnce",
    );
    const end = statusHandoffJs.indexOf(
      "function resetPostAccessBootstrap",
      start,
    );
    const body = statusHandoffJs.slice(start, end);
    const infraIdx = body.indexOf("checkInfraSetupGate");
    const onboardingIdx = body.indexOf("checkOnboardingGate");
    assert.ok(infraIdx !== -1, "should call checkInfraSetupGate");
    assert.ok(onboardingIdx !== -1, "should still call checkOnboardingGate");
    assert.ok(
      infraIdx < onboardingIdx,
      "infra gate must run before the profile onboarding gate",
    );
  });

  it("does not interrupt the first-run wizard with discovery setup", () => {
    const start = statusHandoffJs.indexOf("async function requestDiscoverySetup");
    const end = statusHandoffJs.indexOf("\n}", start);
    const body = statusHandoffJs.slice(start, end);
    assert.ok(
      body.includes("isFirstRunWizardVisible"),
      "requestDiscoverySetup should defer while the first-run wizard is visible",
    );
  });
});

describe("first-run-wizard module", () => {
  it("exposes the wizard surface, step nav, gate and pure predicates", () => {
    const { api } = loadWizard();
    for (const fn of [
      "showFirstRunWizard",
      "hideFirstRunWizard",
      "isFirstRunWizardVisible",
      "setFirstRunStep",
      "checkInfraSetupGate",
      "firstRunSheetStepComplete",
      "firstRunSigninStepComplete",
      "firstRunOauthClientMissing",
      "computeFirstRunStartStep",
      "initFirstRunWizard",
    ]) {
      assert.equal(
        typeof api[fn],
        "function",
        `firstRunWizard.${fn} should be a function`,
      );
    }
  });

  it("sheet-step completion reflects a connected sheet id", () => {
    let sheetId = "";
    const { api } = loadWizard({
      getSheetId: () => sheetId,
      isSignedIn: () => false,
      getOAuthClientId: () => "cid.apps.googleusercontent.com",
    });
    assert.equal(api.firstRunSheetStepComplete(), false);
    sheetId = "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-";
    assert.equal(api.firstRunSheetStepComplete(), true);
  });

  it("sign-in step completion reflects the auth session", () => {
    let signedIn = false;
    const { api } = loadWizard({
      getSheetId: () => "sheet",
      isSignedIn: () => signedIn,
      getOAuthClientId: () => "cid.apps.googleusercontent.com",
    });
    assert.equal(api.firstRunSigninStepComplete(), false);
    signedIn = true;
    assert.equal(api.firstRunSigninStepComplete(), true);
  });

  it("flags a missing OAuth client id", () => {
    let cid = null;
    const { api } = loadWizard({
      getSheetId: () => "sheet",
      isSignedIn: () => false,
      getOAuthClientId: () => cid,
    });
    assert.equal(api.firstRunOauthClientMissing(), true);
    cid = "cid.apps.googleusercontent.com";
    assert.equal(api.firstRunOauthClientMissing(), false);
  });

  it("computes the first incomplete step as the start step", () => {
    const make = (sheetId, signedIn) =>
      loadWizard({
        getSheetId: () => sheetId,
        isSignedIn: () => signedIn,
        getOAuthClientId: () => "cid.apps.googleusercontent.com",
      }).api;
    assert.equal(make("", false).computeFirstRunStartStep(), 1);
    assert.equal(make("sheet", false).computeFirstRunStartStep(), 2);
    assert.equal(make("sheet", true).computeFirstRunStartStep(), 3);
  });

  it("checkInfraSetupGate returns false when infra setup is already complete", async () => {
    const { api } = loadWizard({
      getUserContent: () => ({
        openDb: async () => {},
        isInfraSetupComplete: async () => true,
      }),
      getSheetId: () => "sheet",
      isSignedIn: () => true,
      getOAuthClientId: () => "cid.apps.googleusercontent.com",
    });
    const handled = await api.checkInfraSetupGate();
    assert.equal(!!handled, false);
  });

  it("checkInfraSetupGate returns true (owns the surface) when infra setup is incomplete", async () => {
    const { api } = loadWizard({
      getUserContent: () => ({
        openDb: async () => {},
        isInfraSetupComplete: async () => false,
      }),
      getSheetId: () => "",
      isSignedIn: () => false,
      getOAuthClientId: () => "cid.apps.googleusercontent.com",
    });
    const handled = await api.checkInfraSetupGate();
    assert.equal(handled, true);
  });

  it("checkInfraSetupGate does not block when the content store is unavailable", async () => {
    const { api } = loadWizard({
      getUserContent: () => null,
    });
    const handled = await api.checkInfraSetupGate();
    assert.equal(!!handled, false);
  });

  it("reuses the existing sheet/auth primitives rather than reimplementing them", () => {
    for (const ref of [
      "parseGoogleSheetId",
      "mergeStoredConfigOverridePatch",
      "handleSetupCreateStarterSheet",
      "signIn",
      "isSignedIn",
      "getOAuthClientId",
    ]) {
      assert.ok(
        firstRunWizardJs.includes(ref),
        `first-run-wizard.js should reuse ${ref}`,
      );
    }
  });
});

describe("first-run wizard markup + wiring", () => {
  it("partial defines the wizard surface and ordered step panels", () => {
    assert.match(firstRunPartial, /id="firstRunWizard"/);
    for (const id of [
      "firstRunPanelSheet",
      "firstRunPanelSignin",
      "firstRunPanelProvider",
      "firstRunPanelDraft",
    ]) {
      assert.ok(
        firstRunPartial.includes(`id="${id}"`),
        `partial should define ${id}`,
      );
    }
  });

  it("sheet step offers both create and paste-existing controls", () => {
    assert.ok(firstRunPartial.includes('id="firstRunCreateSheetBtn"'));
    assert.ok(firstRunPartial.includes('id="firstRunSheetIdInput"'));
  });

  it("sign-in step offers a sign-in control gated by a Next button", () => {
    assert.ok(firstRunPartial.includes('id="firstRunSignInBtn"'));
    assert.ok(firstRunPartial.includes('id="firstRunSigninNext"'));
  });

  it("index.html loads the wizard partial, script and stylesheet", () => {
    assert.ok(
      indexHtml.includes("first-run-wizard.js"),
      "index.html should load first-run-wizard.js",
    );
    assert.ok(
      indexHtml.includes("css/legacy-first-run-wizard.css"),
      "index.html should load the first-run wizard stylesheet",
    );
    assert.match(
      indexHtml,
      /id="firstRunWizard"/,
      "expanded index.html should include the wizard markup",
    );
  });

  it("wires checkInfraSetupGate through the compat + bridge layers", () => {
    assert.match(
      appCompatJs,
      /function checkInfraSetupGate\(\.\.\.args\)/,
      "app-compat.js should expose a checkInfraSetupGate global",
    );
    assert.ok(
      bridgeRegistryJs.includes("checkInfraSetupGate: host.checkInfraSetupGate"),
      "bridge-registry.js should map checkInfraSetupGate to discovery.status.host",
    );
    assert.ok(
      appBootstrapJs.includes("checkInfraSetupGate"),
      "app-bootstrap.js should invoke the infra gate on the cold-start path",
    );
  });
});

describe("first-run wizard — provider + draft steps", () => {
  const providerHost = (over) => ({
    getSheetId: () => "sheet",
    isSignedIn: () => true,
    getOAuthClientId: () => "cid.apps.googleusercontent.com",
    getResumeGenerate: () => ({
      isResumeGenerationConfigured: () => false,
      getResumeGenerationConfig: () => ({
        provider: "openrouter",
        resumeOpenRouterApiKey: "",
        resumeLocalModel: "gemma4:e2b",
      }),
    }),
    ...over,
  });

  it("exposes the provider/draft step API surface", () => {
    const { api } = loadWizard(providerHost());
    for (const fn of [
      "firstRunProviderStepComplete",
      "firstRunDraftStepComplete",
      "firstRunSaveOpenRouterKey",
      "firstRunSelectProvider",
      "firstRunCanFinish",
    ]) {
      assert.equal(
        typeof api[fn],
        "function",
        `firstRunWizard.${fn} should be a function`,
      );
    }
  });

  it("provider-step completion reflects isResumeGenerationConfigured()", () => {
    let configured = false;
    const { api } = loadWizard(
      providerHost({
        getResumeGenerate: () => ({
          isResumeGenerationConfigured: () => configured,
          getResumeGenerationConfig: () => ({ provider: "openrouter" }),
        }),
      }),
    );
    assert.equal(api.firstRunProviderStepComplete(), false);
    configured = true;
    assert.equal(api.firstRunProviderStepComplete(), true);
  });

  it("computeFirstRunStartStep caps at 3 until the provider is configured, then reaches 4", () => {
    let configured = false;
    const { api } = loadWizard(
      providerHost({
        getResumeGenerate: () => ({
          isResumeGenerationConfigured: () => configured,
          getResumeGenerationConfig: () => ({ provider: "openrouter" }),
        }),
      }),
    );
    assert.equal(api.computeFirstRunStartStep(), 3);
    configured = true;
    assert.equal(api.computeFirstRunStartStep(), 4);
  });

  it("saving a valid OpenRouter key persists it via mergeStoredConfigOverridePatch and the live config", () => {
    const patches = [];
    const { api, window } = loadWizard(
      providerHost({
        mergeStoredConfigOverridePatch: (patch) => patches.push(patch),
      }),
    );
    window.COMMAND_CENTER_CONFIG = {};
    const result = api.firstRunSaveOpenRouterKey("sk-or-v1-abcdef0123456789");
    assert.equal(result.ok, true);
    assert.equal(patches.length, 1);
    assert.equal(
      patches[0].resumeOpenRouterApiKey,
      "sk-or-v1-abcdef0123456789",
    );
    assert.equal(
      window.COMMAND_CENTER_CONFIG.resumeOpenRouterApiKey,
      "sk-or-v1-abcdef0123456789",
    );
  });

  it("rejects an OpenRouter key with the wrong shape without persisting", () => {
    const patches = [];
    const { api, window } = loadWizard(
      providerHost({
        mergeStoredConfigOverridePatch: (patch) => patches.push(patch),
      }),
    );
    window.COMMAND_CENTER_CONFIG = {};
    const result = api.firstRunSaveOpenRouterKey("not-a-key");
    assert.equal(result.ok, false);
    assert.equal(result.reason, "shape");
    assert.equal(patches.length, 0);
  });

  it("selecting a provider persists resumeProvider via mergeStoredConfigOverridePatch and live config", () => {
    const patches = [];
    const { api, window } = loadWizard(
      providerHost({
        mergeStoredConfigOverridePatch: (patch) => patches.push(patch),
      }),
    );
    window.COMMAND_CENTER_CONFIG = {};
    api.firstRunSelectProvider("local");
    assert.equal(patches.length >= 1, true);
    assert.equal(patches[0].resumeProvider, "local");
    assert.equal(window.COMMAND_CENTER_CONFIG.resumeProvider, "local");
  });

  it("cannot finish until sheet, sign-in, provider and a produced draft are all satisfied", () => {
    let configured = false;
    const { api } = loadWizard(
      providerHost({
        getResumeGenerate: () => ({
          isResumeGenerationConfigured: () => configured,
          getResumeGenerationConfig: () => ({ provider: "openrouter" }),
        }),
      }),
    );
    assert.equal(api.firstRunCanFinish(), false);
    configured = true;
    // provider now configured but no draft produced yet
    assert.equal(api.firstRunCanFinish(), false);
  });

  it("mirrors the onboarding key-save pattern (mergeStoredConfigOverridePatch + live config) and reuses runResumeGeneration", () => {
    assert.ok(
      firstRunWizardJs.includes("mergeStoredConfigOverridePatch"),
      "wizard should persist the key via mergeStoredConfigOverridePatch",
    );
    assert.ok(
      /COMMAND_CENTER_CONFIG\.resumeOpenRouterApiKey\s*=/.test(firstRunWizardJs),
      "wizard should apply the pasted key to the live config object",
    );
    assert.ok(
      firstRunWizardJs.includes("runResumeGeneration"),
      "draft step should reuse runResumeGeneration",
    );
    assert.ok(
      firstRunWizardJs.includes("completeInfraSetup"),
      "finish should mark infra setup complete",
    );
  });
});

describe("runResumeGeneration surfaces insights for reuse", () => {
  it("returns insights + insightsError alongside the draft text", () => {
    const start = resumeGenerationJs.indexOf(
      "async function runResumeGeneration",
    );
    const end = resumeGenerationJs.indexOf(
      "async function refineLastResumeGeneration",
      start,
    );
    const body = resumeGenerationJs.slice(start, end);
    const returnIdx = body.indexOf("return {");
    assert.ok(returnIdx >= 0, "runResumeGeneration must return an object");
    const returnBlock = body.slice(returnIdx, returnIdx + 220);
    assert.ok(
      /\binsights\b/.test(returnBlock),
      "the success return must include insights so the wizard can render them",
    );
    assert.ok(
      /\binsightsError\b/.test(returnBlock),
      "the success return must include insightsError",
    );
  });
});

describe("runResumeGeneration is reachable from the wizard host", () => {
  it("app.js registers runResumeGeneration on the host literal", () => {
    assert.match(
      appJs,
      /\n\s*runResumeGeneration,/,
      "app.js host literal should include runResumeGeneration",
    );
  });

  it("bridge-registry maps runResumeGeneration onto app.core.host", () => {
    assert.ok(
      bridgeRegistryJs.includes(
        "runResumeGeneration: host.runResumeGeneration",
      ),
      "bridge-registry.js should expose runResumeGeneration on app.core.host",
    );
  });
});

describe("first-run wizard markup — provider + draft controls", () => {
  it("provider step presents OpenRouter (checked) and local options", () => {
    assert.ok(firstRunPartial.includes('value="openrouter"'));
    assert.ok(firstRunPartial.includes('value="local"'));
    assert.ok(
      /value="openrouter"[^>]*checked|checked[^>]*value="openrouter"/.test(
        firstRunPartial,
      ),
      "the OpenRouter option should be preselected",
    );
  });

  it("provider step has an inline OpenRouter key field and a get-a-free-key link", () => {
    assert.ok(firstRunPartial.includes('id="firstRunOpenRouterKeyInput"'));
    assert.ok(firstRunPartial.includes("openrouter.ai/keys"));
  });

  it("provider step surfaces the local model select and the download-model control container", () => {
    assert.ok(firstRunPartial.includes('id="firstRunLocalModelSelect"'));
    assert.ok(firstRunPartial.includes('id="firstRunLocalDownloadControl"'));
  });

  it("draft step has a generate control and an inline draft + insights region", () => {
    assert.ok(firstRunPartial.includes('id="firstRunGenerateDraftBtn"'));
    assert.ok(firstRunPartial.includes('id="firstRunDraftText"'));
    assert.ok(firstRunPartial.includes('id="firstRunDraftInsights"'));
  });
});

// --- M3: persistence, profile-wizard handoff, Settings re-entry ---------

describe("first-run wizard — finish hands off to the profile wizard (VAL-WIZ-009)", () => {
  it("handleFirstRunFinish marks infra complete THEN runs the profile onboarding gate", () => {
    const start = firstRunWizardJs.indexOf(
      "async function handleFirstRunFinish",
    );
    const end = firstRunWizardJs.indexOf("// --- Step 1: Sheet", start);
    assert.ok(start !== -1 && end !== -1, "should isolate handleFirstRunFinish");
    const body = firstRunWizardJs.slice(start, end);
    const completeIdx = body.indexOf("completeInfraSetup");
    const gateIdx = body.indexOf("checkOnboardingGate");
    assert.ok(completeIdx !== -1, "finish must persist infraSetupComplete");
    assert.ok(
      gateIdx !== -1,
      "finish must hand off to the profile onboarding gate (checkOnboardingGate)",
    );
    assert.ok(
      completeIdx < gateIdx,
      "infra completion must be persisted before handing off to the profile wizard",
    );
  });

  it("checkOnboardingGate is reachable from the wizard host (app.core.host)", () => {
    const start = bridgeRegistryJs.indexOf("app.core.host = {");
    const end = bridgeRegistryJs.indexOf("Object.assign(app.core", start);
    assert.ok(start !== -1 && end !== -1, "should isolate app.core.host literal");
    const coreHost = bridgeRegistryJs.slice(start, end);
    assert.ok(
      coreHost.includes("checkOnboardingGate: host.checkOnboardingGate"),
      "app.core.host should expose checkOnboardingGate so the wizard can hand off",
    );
  });
});

describe("first-run wizard — Settings 'Run setup again' re-entry (VAL-WIZ-010)", () => {
  const allCompleteHost = (over) => ({
    getSheetId: () => "sheet-keep",
    isSignedIn: () => true,
    getOAuthClientId: () => "cid.apps.googleusercontent.com",
    getResumeGenerate: () => ({
      isResumeGenerationConfigured: () => true,
      getResumeGenerationConfig: () => ({
        provider: "openrouter",
        resumeOpenRouterApiKey: "sk-or-keep",
      }),
    }),
    ...over,
  });

  it("exposes reopenFirstRunWizard on the module surface", () => {
    const { api } = loadWizard(allCompleteHost());
    assert.equal(typeof api.reopenFirstRunWizard, "function");
  });

  it("reopens at step 1 even when every prerequisite is already satisfied", () => {
    const { api, window, document } = loadWizard(allCompleteHost());
    window.COMMAND_CENTER_CONFIG = {
      resumeProvider: "openrouter",
      resumeOpenRouterApiKey: "sk-or-keep",
      sheetId: "sheet-keep",
    };
    api.reopenFirstRunWizard();
    assert.equal(api.isFirstRunWizardVisible(), true, "wizard should be shown");
    assert.equal(
      document.getElementById("firstRunPanelSheet").style.display,
      "block",
      "re-entry should land on step 1 (Sheet panel), not the furthest step",
    );
  });

  it("Settings markup exposes an infra 'Run setup again' control next to the profile reset", () => {
    assert.ok(
      settingsModalHtml.includes('id="infraResetWizardBtn"'),
      "settings-modal.html should define #infraResetWizardBtn",
    );
    assert.ok(
      settingsModalHtml.includes('id="profileResetWizardBtn"'),
      "the infra control should sit alongside the existing profile reset",
    );
  });

  it("maps infraResetWizardBtn to the SETUP settings tab", () => {
    assert.match(
      settingsTabSchemaJs,
      /infraResetWizardBtn:\s*SETTINGS_TAB_IDS\.SETUP/,
      "infraResetWizardBtn should resolve to the SETUP tab",
    );
  });

  it("materials-feature wires the infra reset to resetInfraSetupCompletion + reopen", () => {
    assert.ok(
      materialsFeatureJs.includes("infraResetWizardBtn"),
      "materials-feature should bind the infra reset button",
    );
    assert.ok(
      materialsFeatureJs.includes("resetInfraSetupCompletion"),
      "the handler should reset the infraSetupComplete flag",
    );
    assert.ok(
      materialsFeatureJs.includes("reopenFirstRunWizard"),
      "the handler should reopen the first-run infra wizard",
    );
  });
});

describe("Settings provider switch persists across reload (VAL-CROSS-004)", () => {
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
      console,
      document: { getElementById: () => null },
    };
    vm.createContext(ctx);
    vm.runInContext(configOverridesJs, ctx, { filename: "config-overrides.js" });
    return { api: window.JobBoredApp.configOverrides, window, store };
  }

  it("resumeProvider is on the override allowlist alongside the resume keys", () => {
    const { api } = loadConfigOverrides();
    for (const key of [
      "resumeProvider",
      "resumeOpenRouterApiKey",
      "resumeLocalModel",
      "resumeLocalBaseUrl",
    ]) {
      assert.ok(
        api.COMMAND_CENTER_OVERRIDE_KEYS.includes(key),
        `${key} must be on the allowlist or Settings values drop on save`,
      );
    }
  });

  it("a provider switch saved in Settings survives a reload and preserves existing config", () => {
    const s1 = loadConfigOverrides();
    s1.api.writeStoredConfigOverrides({
      sheetId: "sheet-123",
      resumeProvider: "local",
      resumeLocalModel: "gemma4:e2b",
      resumeLocalBaseUrl: "http://127.0.0.1:11434/v1",
      resumeOpenRouterApiKey: "sk-or-keep",
    });
    assert.equal(
      s1.window.COMMAND_CENTER_CONFIG.resumeProvider,
      "local",
      "the live config should honor the switch same-tick",
    );

    // Hard reload = a fresh window + module load reading the SAME localStorage.
    const s2 = loadConfigOverrides(Object.fromEntries(s1.store));
    assert.equal(
      s2.window.COMMAND_CENTER_CONFIG.resumeProvider,
      "local",
      "the persisted provider switch should be honored after reload",
    );
    assert.equal(s2.window.COMMAND_CENTER_CONFIG.resumeLocalModel, "gemma4:e2b");
    assert.equal(
      s2.window.COMMAND_CENTER_CONFIG.sheetId,
      "sheet-123",
      "existing sheetId must not be corrupted by the switch",
    );
    assert.equal(
      s2.window.COMMAND_CENTER_CONFIG.resumeOpenRouterApiKey,
      "sk-or-keep",
      "existing provider keys must be preserved",
    );
  });
});

// --- VAL-WIZ-011: the wizard is a dismissible modal, never a permanent trap ---

describe("first-run wizard — dismissible modal, no stuck overlay (VAL-WIZ-011)", () => {
  // A DOM stub that records event listeners so we can fire the wizard's own
  // close-button click and the document-level Escape handler, then assert the
  // overlay is actually torn down (display none) with no body scroll-lock left.
  function makeRecordingEl(id) {
    const listeners = {};
    return {
      id,
      style: {},
      dataset: {},
      hidden: false,
      disabled: false,
      value: "",
      textContent: "",
      className: "",
      checked: false,
      innerHTML: "",
      classList: {
        add() {},
        remove() {},
        toggle() {},
        contains() {
          return false;
        },
      },
      addEventListener(type, fn) {
        (listeners[type] = listeners[type] || []).push(fn);
      },
      removeEventListener() {},
      setAttribute() {},
      removeAttribute() {},
      getAttribute() {
        return null;
      },
      appendChild() {},
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
        (listeners[type] || []).forEach((fn) => fn(ev || {}));
      },
    };
  }

  function makeRecordingDoc() {
    const els = new Map();
    const docListeners = {};
    const body = makeRecordingEl("body");
    return {
      readyState: "complete",
      body,
      getElementById(id) {
        if (!els.has(id)) els.set(id, makeRecordingEl(id));
        return els.get(id);
      },
      querySelector() {
        return null;
      },
      querySelectorAll() {
        return [];
      },
      addEventListener(type, fn) {
        (docListeners[type] = docListeners[type] || []).push(fn);
      },
      createElement() {
        return makeRecordingEl("created");
      },
      __fireDoc(type, ev) {
        (docListeners[type] || []).forEach((fn) => fn(ev || {}));
      },
    };
  }

  function loadWizardWithDom(hostStub) {
    const window = {
      JobBoredApp: { core: { host: hostStub || {} } },
      COMMAND_CENTER_CONFIG: {},
    };
    const document = makeRecordingDoc();
    // Deliberately omit setInterval so the 700ms refresh loop is a no-op here.
    const ctx = {
      window,
      document,
      console,
      setTimeout,
      requestAnimationFrame: (fn) => fn(),
    };
    vm.createContext(ctx);
    vm.runInContext(firstRunWizardJs, ctx, { filename: "first-run-wizard.js" });
    return { api: window.JobBoredApp.firstRunWizard, window, document };
  }

  const allCompleteHost = () => ({
    getSheetId: () => "sheet-keep",
    isSignedIn: () => true,
    getOAuthClientId: () => "cid.apps.googleusercontent.com",
    getResumeGenerate: () => ({
      isResumeGenerationConfigured: () => true,
      getResumeGenerationConfig: () => ({
        provider: "openrouter",
        resumeOpenRouterApiKey: "sk-or-keep",
      }),
    }),
  });

  it("the partial exposes a labeled close/dismiss control on the wizard card", () => {
    assert.ok(
      firstRunPartial.includes('id="firstRunWizardClose"'),
      "the wizard must offer a close control so it is never a permanent overlay",
    );
    assert.match(
      firstRunPartial,
      /id="firstRunWizardClose"[\s\S]*?aria-label="[^"]+"/,
      "the close control must be accessibly labeled",
    );
    assert.match(
      firstRunWizardCss,
      /\.first-run-wizard__close/,
      "the close control must be positioned via CSS",
    );
  });

  it("clicking the close control tears down the overlay (display none), restoring the page", () => {
    const { api, document } = loadWizardWithDom(allCompleteHost());
    api.reopenFirstRunWizard();
    const wiz = document.getElementById("firstRunWizard");
    assert.equal(wiz.style.display, "flex", "reopen should show the overlay");
    assert.equal(api.isFirstRunWizardVisible(), true);

    document.getElementById("firstRunWizardClose").__fire("click", {});

    assert.equal(
      wiz.style.display,
      "none",
      "the close control must hide the fixed overlay so clicks reach the dashboard again",
    );
    assert.equal(api.isFirstRunWizardVisible(), false);
  });

  it("Escape dismisses the wizard (it is the topmost overlay)", () => {
    const { api, document } = loadWizardWithDom(allCompleteHost());
    api.reopenFirstRunWizard();
    assert.equal(api.isFirstRunWizardVisible(), true);

    document.__fireDoc("keydown", { key: "Escape" });

    assert.equal(
      api.isFirstRunWizardVisible(),
      false,
      "pressing Escape over the wizard must dismiss it, not trap the user",
    );
  });

  it("opening then hiding the wizard leaves no body scroll-lock / modal-open state behind", () => {
    const { api, document } = loadWizardWithDom(allCompleteHost());
    api.reopenFirstRunWizard();
    api.hideFirstRunWizard();
    assert.equal(api.isFirstRunWizardVisible(), false);
    assert.ok(
      !document.body.style.overflow,
      "the wizard must never lock body scroll (no leftover overflow:hidden)",
    );
  });
});
