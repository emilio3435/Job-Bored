import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

/* ============================================================
   Regression: "Clear settings" did not greenfield installs whose
   config.js bakes in a sheetId.

   Overrides merge ON TOP of the file config, so removing the
   override key just let config.js's sheetId flow back on reload:
   the app booted "configured", sign-in was one silent grant away,
   and the sheet data reappeared. The fix writes an explicit
   `{ sheetId: "" }` mask so getConfig() treats the install as
   unconfigured and the app lands in the cold-start path.
   ============================================================ */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const settingsModalJs = readFileSync(
  join(repoRoot, "settings-modal.js"),
  "utf8",
);

/** Slice a top-level `async function name(...) { ... }` out of a source file. */
function extractFunction(source, name) {
  const start = source.indexOf(`async function ${name}`);
  assert.notEqual(start, -1, `${name} must exist`);
  const open = source.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`unbalanced braces in ${name}`);
}

const OVERRIDE_KEY = "command_center_config_overrides";
const FORCE_CONSENT_KEY = "command_center_force_consent_prompt";

async function runClear({ initialStorage = {} } = {}) {
  const store = new Map(Object.entries(initialStorage));
  let reloaded = false;
  const timers = [];
  const ctx = {
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    },
    window: {
      location: {
        reload() {
          reloaded = true;
        },
      },
      indexedDB: {
        deleteDatabase() {
          return { onsuccess: null, onerror: null, onblocked: null };
        },
      },
    },
    indexedDB: {
      deleteDatabase() {
        return { onsuccess: null, onerror: null, onblocked: null };
      },
    },
    setTimeout(fn, ms) {
      timers.push({ fn, ms });
      return timers.length;
    },
    clearTimeout() {},
    JSON,
    Promise,
    Object,
    String,
    console,
    host: () => ({
      canUseLocalStorage: () => true,
      getAccessToken: () => null,
      clearSessionAuthState() {},
      clearPersistedOAuthSession() {},
      clearPersistedRuntimeOAuthSession() {},
      getCommandCenterConfigOverrideKey: () => OVERRIDE_KEY,
      getDiscoveryRunTrackerKey: () => "command_center_discovery_run_tracker",
      getForceConsentPromptKey: () => FORCE_CONSENT_KEY,
    }),
    showToast() {},
    hideSettingsClearConfirmBar() {},
  };
  vm.createContext(ctx);
  vm.runInContext(
    extractFunction(settingsModalJs, "performSettingsClearOverrides"),
    ctx,
    { filename: "settings-modal.js#performSettingsClearOverrides" },
  );
  const done = vm.runInContext("performSettingsClearOverrides()", ctx);
  // The IndexedDB-wipe step awaits a stubbed setTimeout (its 1.5s hard
  // timeout). Flush captured timers between macrotasks until the clear
  // settles, bounded so a regression can't hang the test runner.
  let settled = false;
  done.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  for (let i = 0; i < 20 && !settled; i++) {
    await new Promise((resolve) => setImmediate(resolve));
    timers.splice(0).forEach((t) => t.fn());
  }
  await done;
  return { store, reloaded };
}

describe("Clear settings greenfields config.js installs", () => {
  it("writes an explicit empty sheetId mask so a file-configured sheet cannot flow back", async () => {
    // Let pending timers fire while awaiting: drive via real microtasks.
    const pending = runClear({
      initialStorage: {
        [OVERRIDE_KEY]: JSON.stringify({
          sheetId: "1OldSheetIdFromAPriorSession",
          resumeOpenRouterApiKey: "sk-or-secret",
          discoveryWebhookUrl: "https://example.com/hook",
        }),
      },
    });
    // The deleteDatabase wrapper waits on a setTimeout we stubbed; give the
    // promise a tick, then resolve it by flushing timers inside runClear.
    const { store, reloaded } = await pending;
    const mask = JSON.parse(store.get(OVERRIDE_KEY));
    assert.deepEqual(
      mask,
      { sheetId: "", oauthClientId: "" },
      "after Clear settings the override store must hold ONLY the greenfield masks — " +
        "without them, a sheetId/oauthClientId baked into config.js boots the app straight " +
        "back into configured mode with instant re-sign-in",
    );
    assert.equal(
      store.get(FORCE_CONSENT_KEY),
      "1",
      "the one-shot force-consent flag must survive the clear so the next sign-in shows the consent screen",
    );
    assert.equal(reloaded, true, "clear must end in a reload");
  });

  it("drops every prior override (keys, webhooks) — nothing leaks across the reset", async () => {
    const { store } = await runClear({
      initialStorage: {
        [OVERRIDE_KEY]: JSON.stringify({
          oauthClientId: "x.apps.googleusercontent.com",
          resumeGeminiApiKey: "AIza-secret",
        }),
      },
    });
    const mask = JSON.parse(store.get(OVERRIDE_KEY));
    assert.deepEqual(Object.keys(mask).sort(), ["oauthClientId", "sheetId"]);
    assert.ok(!("resumeGeminiApiKey" in mask), "saved API keys must not survive");
    assert.equal(
      mask.oauthClientId,
      "",
      "the saved client id must be replaced by an explicit empty mask, not preserved",
    );
  });
});
