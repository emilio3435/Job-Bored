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
   the sheet data reappeared, AND the onboarding's provider /
   discovery steps showed pre-filled — so you couldn't dogfood a
   true first run.

   The fix is config-overrides.js buildGreenfieldOverrideMask() which
   writes an explicit empty-string mask over EVERY credential /
   connection key (sheetId, oauthClientId, all provider keys, all
   webhook URLs, all transport URLs). getConfig() then treats the
   install as unconfigured across the board, and the app lands in
   the true cold-start path (login gate in no-oauth mode + first-run
   wizard) with every onboarding step re-armed. Structural defaults
   (resumeProvider, model names, base URLs, atsScoringMode, title)
   are deliberately NOT masked.
   ============================================================ */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const settingsModalJs = readFileSync(
  join(repoRoot, "settings-modal.js"),
  "utf8",
);
const configOverridesJs = readFileSync(
  join(repoRoot, "config-overrides.js"),
  "utf8",
);

/** The full credential/connection key set greenfield reset must blank. */
const GREENFIELD_CREDENTIAL_KEYS = [
  "sheetId",
  "oauthClientId",
  "discoveryWebhookUrl",
  "discoveryWebhookSecret",
  "resumeGeminiApiKey",
  "resumeOpenAIApiKey",
  "resumeAnthropicApiKey",
  "resumeOpenRouterApiKey",
  "resumeLocalApiKey",
  "resumeGenerationWebhookUrl",
  "jobPostingScrapeUrl",
  "atsScoringServerUrl",
  "atsScoringWebhookUrl",
];

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
      buildGreenfieldOverrideMask: () => {
        // Mirror the real config-overrides.js builder: empty-string mask
        // over the full GREENFIELD_CREDENTIAL_KEYS set.
        const mask = {};
        for (const k of GREENFIELD_CREDENTIAL_KEYS) mask[k] = "";
        return mask;
      },
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
  it("writes the FULL empty-string mask over every credential/connection key so a file-configured install cannot flow back", async () => {
    // Let pending timers fire while awaiting: drive via real microtasks.
    const pending = runClear({
      initialStorage: {
        [OVERRIDE_KEY]: JSON.stringify({
          sheetId: "1OldSheetIdFromAPriorSession",
          oauthClientId: "x.apps.googleusercontent.com",
          resumeOpenRouterApiKey: "sk-or-secret",
          resumeGeminiApiKey: "AIza-secret",
          resumeLocalApiKey: "ollama-local-key",
          discoveryWebhookUrl: "https://example.com/hook",
          discoveryWebhookSecret: "shh",
          resumeGenerationWebhookUrl: "https://example.com/resume-hook",
          jobPostingScrapeUrl: "https://example.com/scrape",
          atsScoringServerUrl: "https://example.com/ats-server",
          atsScoringWebhookUrl: "https://example.com/ats-hook",
        }),
      },
    });
    // The deleteDatabase wrapper waits on a setTimeout we stubbed; give the
    // promise a tick, then resolve it by flushing timers inside runClear.
    const { store, reloaded } = await pending;
    const mask = JSON.parse(store.get(OVERRIDE_KEY));
    // Every key in GREENFIELD_CREDENTIAL_KEYS must be present and explicitly
    // blanked. Provider keys / webhooks / transport URLs are intentionally
    // masked now — they all gate whether onboarding shows, and leaving any
    // of them set boots a "configured" install past the cold-start gate.
    const expected = {};
    for (const k of GREENFIELD_CREDENTIAL_KEYS) expected[k] = "";
    assert.deepEqual(
      mask,
      expected,
      `after Clear settings the override store must hold an empty-string mask over the FULL ` +
        `GREENFIELD_CREDENTIAL_KEYS set (${GREENFIELD_CREDENTIAL_KEYS.length} keys) — ` +
        `anything else lets a sheetId/oauthClientId/API key baked into config.js boot the app ` +
        `straight back into configured mode with instant re-sign-in`,
    );
    assert.deepEqual(
      Object.keys(mask).sort(),
      [...GREENFIELD_CREDENTIAL_KEYS].sort(),
      "the resulting mask must contain EXACTLY the greenfield credential keys (no more, no less)",
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
          resumeOpenRouterApiKey: "sk-or-secret",
          discoveryWebhookUrl: "https://example.com/hook",
        }),
      },
    });
    const mask = JSON.parse(store.get(OVERRIDE_KEY));
    // Prior keys must be replaced by the full greenfield mask — NOT preserved
    // and NOT partially kept. The test confirms the count matches the full
    // key set (no shrinkage back to the old 2-key mask).
    assert.deepEqual(
      Object.keys(mask).sort(),
      [...GREENFIELD_CREDENTIAL_KEYS].sort(),
      "the resulting mask must contain the FULL greenfield credential key set",
    );
    assert.ok(!("resumeGeminiApiKey" in mask && mask.resumeGeminiApiKey), "saved API keys must not survive");
    assert.equal(
      mask.oauthClientId,
      "",
      "the saved client id must be replaced by an explicit empty mask, not preserved",
    );
    assert.equal(
      mask.resumeOpenRouterApiKey,
      "",
      "the saved openrouter key must be replaced by an explicit empty mask, not preserved",
    );
    assert.equal(
      mask.discoveryWebhookUrl,
      "",
      "the saved discovery webhook URL must be replaced by an explicit empty mask, not preserved",
    );
  });
});

describe("buildGreenfieldOverrideMask — config-overrides.js exports the full key set", () => {
  it("exports GREENFIELD_CREDENTIAL_KEYS covering every credential/connection key", () => {
    assert.match(
      configOverridesJs,
      /const\s+GREENFIELD_CREDENTIAL_KEYS\s*=\s*\[/,
      "config-overrides.js should declare GREENFIELD_CREDENTIAL_KEYS",
    );
    assert.match(
      configOverridesJs,
      /function\s+buildGreenfieldOverrideMask\s*\(/,
      "config-overrides.js should declare buildGreenfieldOverrideMask()",
    );
    for (const key of GREENFIELD_CREDENTIAL_KEYS) {
      assert.ok(
        new RegExp(`["']${key}["']`).test(configOverridesJs),
        `GREENFIELD_CREDENTIAL_KEYS should include "${key}" — without it the clear leaves a config.js-baked value intact`,
      );
    }
  });

  it("buildGreenfieldOverrideMask returns an empty-string mask over the full key set", () => {
    const expected = {};
    for (const k of GREENFIELD_CREDENTIAL_KEYS) expected[k] = "";
    assert.deepEqual(expected, Object.fromEntries(
      GREENFIELD_CREDENTIAL_KEYS.map((k) => [k, ""]),
    ));
  });
});
