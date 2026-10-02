import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { flush, loadConfigTab, makeOrigin } from "./holes-auth-harness.mjs";

/* ============================================================
   HOLES AUTH — settings live in one browser, so every tab sees them.

   A16 a settings save in one tab reaches the others over jb-config,
       so no tab keeps acting on (or writing back) a stale copy;
   A13 ?greenfield=1 also drops this tab's sessionStorage token, where
       the token has lived since it left localStorage.

   Against the real config-overrides.js in vm tabs of one origin.
   ============================================================ */

const OVERRIDE_KEY = "command_center_config_overrides";
const RUNTIME_KEY = "command_center_oauth_runtime";

describe("A16 · settings changes reach every open tab over jb-config", () => {
  it("updates the other tab's live config and tells its page", async () => {
    const origin = makeOrigin();
    const a = loadConfigTab(origin, { config: { resumeProvider: "gemini" } });
    const b = loadConfigTab(origin, { config: { resumeProvider: "gemini" } });

    b.overrides.mergeStoredConfigOverridePatch({
      resumeProvider: "openai",
      resumeOpenAIApiKey: "sk-example-new",
    });
    await flush();

    assert.equal(a.config().resumeProvider, "openai");
    assert.equal(a.config().resumeOpenAIApiKey, "sk-example-new");
    assert.deepEqual(
      a.events.map((e) => e.type),
      ["jb:config:changed"],
      "the page can refresh what it shows",
    );
  });

  it("keeps a stale tab from writing its old copy back", async () => {
    const origin = makeOrigin();
    const a = loadConfigTab(origin, { config: { resumeProvider: "gemini" } });
    const b = loadConfigTab(origin, { config: { resumeProvider: "gemini" } });
    b.overrides.mergeStoredConfigOverridePatch({ resumeProvider: "anthropic" });
    await flush();

    // Tab A acts on what it holds: its live provider, saved with a new key.
    a.overrides.mergeStoredConfigOverridePatch({
      resumeProvider: a.config().resumeProvider,
      resumeAnthropicApiKey: "sk-ant-example",
    });

    const stored = JSON.parse(origin.localStorage.getItem(OVERRIDE_KEY));
    assert.equal(stored.resumeProvider, "anthropic", "tab B's choice survives tab A's save");
  });

  it("sends a bare notice — no values, no echo back", async () => {
    const origin = makeOrigin();
    loadConfigTab(origin);
    const b = loadConfigTab(origin);
    b.overrides.mergeStoredConfigOverridePatch({ resumeGeminiApiKey: "AIza-example-secret" });
    await flush();

    const notices = origin.posted.filter((p) => p.name === "jb-config");
    assert.equal(notices.length, 1, "the receiving tab does not re-broadcast");
    assert.equal(JSON.stringify(notices).includes("AIza-example-secret"), false);
  });
});

describe("A13 · ?greenfield=1 leaves no Google token behind", () => {
  const token = JSON.stringify({
    hasOauthSession: true,
    accessToken: "tok-example",
    expiresAt: Date.now() + 60_000,
    oauthClientId: "client-123.apps.googleusercontent.com",
  });

  it("removes this tab's sessionStorage token", () => {
    const tab = loadConfigTab(makeOrigin(), {
      search: "?greenfield=1",
      session: { [RUNTIME_KEY]: token },
    });
    assert.equal(tab.sessionStorage.getItem(RUNTIME_KEY), null);
  });

  it("leaves the token alone on an ordinary load", () => {
    const tab = loadConfigTab(makeOrigin(), { session: { [RUNTIME_KEY]: token } });
    assert.equal(tab.sessionStorage.getItem(RUNTIME_KEY), token);
  });
});
