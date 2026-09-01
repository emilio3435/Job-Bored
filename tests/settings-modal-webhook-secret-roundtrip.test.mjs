import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

/**
 * F2C-SETUP01-PRESERVE
 *
 * Saving Settings from a form that no longer owns discovery URL/secret
 * fields must not serialize those missing fields as empty strings and wipe
 * the stored webhook identity.
 */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const settingsModalJs = readFileSync(
  join(repoRoot, "settings-modal.js"),
  "utf8",
);

function makeEl(overrides = {}) {
  return {
    value: "",
    textContent: "",
    style: {},
    hidden: false,
    disabled: false,
    classList: {
      add() {},
      remove() {},
      toggle() {},
      contains() {
        return false;
      },
    },
    addEventListener() {},
    ...overrides,
  };
}

function loadSettingsSaveHarness({ presentIds, fieldValues, storedOverrides }) {
  const store = new Map();
  store.set(
    "command_center_config_overrides",
    JSON.stringify(storedOverrides),
  );
  const els = new Map();
  for (const id of presentIds) {
    els.set(id, makeEl({ value: fieldValues[id] || "" }));
  }

  const patches = [];
  const document = {
    readyState: "loading",
    getElementById(id) {
      return els.has(id) ? els.get(id) : null;
    },
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
    addEventListener() {},
    createElement() {
      return makeEl();
    },
  };

  const window = {
    JobBoredApp: {
      settings: {},
      core: {
        host: {
          parseGoogleSheetId: (raw) => String(raw || "").trim() || null,
          normalizeDashboardTitle: (value) => String(value || "").trim(),
          mergeStoredConfigOverridePatch: (patch) => {
            patches.push({ ...patch });
            const next = { ...storedOverrides, ...patch };
            store.set(
              "command_center_config_overrides",
              JSON.stringify(next),
            );
            Object.assign(storedOverrides, patch);
            return next;
          },
          syncDiscoveryButtonState() {},
          applyOAuthClientChange() {
            return true;
          },
          setSHEET_ID() {},
          setDashboardSheetLinks() {},
          normalizeDiscoveryWebhookIdentity: (value) =>
            String(value || "").trim(),
          recordDiscoveryEngineState: async () => {},
          getDiscoveryEngineStateNone: () => "none",
          getManagedAppsScriptWebhookIdentity: () => "",
          getSavedDiscoveryEngineStateForUrl: () => null,
          getDiscoveryEngineStateStubOnly: () => "stub_only",
          getDiscoveryEngineStateUnverified: () => "unverified",
          resolveGeminiModel: () => "gemini-2.5-flash",
          showToast() {},
        },
      },
    },
    JobBoredSettingsTabs: { activateTabForField() {} },
    COMMAND_CENTER_CONFIG: {},
    location: { reload() {} },
  };

  const ctx = {
    window,
    document,
    console,
    setTimeout() {
      return 0;
    },
    clearTimeout() {},
    URL,
    JSON,
    Promise,
    Object,
    String,
    Array,
  };
  vm.createContext(ctx);
  vm.runInContext(settingsModalJs, ctx, { filename: "settings-modal.js" });
  return {
    api: window.JobBoredApp.settings,
    patches,
    store,
    storedOverrides,
  };
}

describe("F2C-SETUP01-PRESERVE: Settings save omits absent discovery fields", () => {
  it("does not serialize missing discovery URL/secret as empty when saving unrelated Settings", async () => {
    const storedOverrides = {
      sheetId: "sheet-keep",
      discoveryWebhookUrl: "https://relay.example.workers.dev/webhook",
      discoveryWebhookSecret: "keep-this-secret",
      resumeProvider: "gemini",
    };
    const { api, patches } = loadSettingsSaveHarness({
      presentIds: [
        "settingsFormError",
        "settingsSheetId",
        "settingsOAuthClientId",
        "settingsTitle",
        "settingsResumeProvider",
      ],
      fieldValues: {
        settingsSheetId: "sheet-keep",
        settingsOAuthClientId: "cid.apps.googleusercontent.com",
        settingsTitle: "JobBored",
        settingsResumeProvider: "gemini",
      },
      storedOverrides,
    });

    await api.saveCommandCenterSettingsFromForm();

    assert.ok(patches.length >= 1, "save must merge a settings patch");
    const patch = patches[0];
    assert.equal(
      Object.prototype.hasOwnProperty.call(patch, "discoveryWebhookUrl"),
      false,
      "absent discovery URL field must be omitted, not written as empty",
    );
    assert.equal(
      Object.prototype.hasOwnProperty.call(patch, "discoveryWebhookSecret"),
      false,
      "absent discovery secret field must be omitted, not written as empty",
    );
    assert.equal(
      storedOverrides.discoveryWebhookUrl,
      "https://relay.example.workers.dev/webhook",
    );
    assert.equal(storedOverrides.discoveryWebhookSecret, "keep-this-secret");
  });

  it("still writes discovery URL/secret when those fields are present on the form", async () => {
    const storedOverrides = {
      sheetId: "sheet-keep",
      discoveryWebhookUrl: "https://old.example/webhook",
      discoveryWebhookSecret: "old-secret",
    };
    const { api, patches } = loadSettingsSaveHarness({
      presentIds: [
        "settingsFormError",
        "settingsSheetId",
        "settingsOAuthClientId",
        "settingsTitle",
        "settingsResumeProvider",
        "settingsDiscoveryWebhookUrl",
        "settingsDiscoveryWebhookSecret",
      ],
      fieldValues: {
        settingsSheetId: "sheet-keep",
        settingsOAuthClientId: "cid.apps.googleusercontent.com",
        settingsTitle: "JobBored",
        settingsResumeProvider: "gemini",
        settingsDiscoveryWebhookUrl: "https://new.example/webhook",
        settingsDiscoveryWebhookSecret: "new-secret",
      },
      storedOverrides,
    });
    await api.saveCommandCenterSettingsFromForm();
    assert.ok(patches.length >= 1, "save must merge a settings patch");
    assert.equal(patches[0].discoveryWebhookUrl, "https://new.example/webhook");
    assert.equal(patches[0].discoveryWebhookSecret, "new-secret");
  });
});
