import assert from "node:assert/strict";
import { describe, it } from "node:test";
import vm from "node:vm";
import { makeFakeDocument, readRepoFile } from "./oneflow-l0-harness.mjs";
import { loadArrival, renderedText } from "./oneflow-l1-harness.mjs";

/* ============================================================
   GREENFIELD C2 + C3 — Beat 1 never punts to Settings.

   GREENFIELD-SPEC §1 F4 / §4.4. A stranger with no OAuth Client ID
   pressed `Continue with Google` and the flow threw them into the
   Settings modal — out of the six beats, into the surface the beats
   exist to replace, with no way back. Beat 1 already carries the whole
   detour: the console link, the six steps, the paste field. It now uses
   it.

     C2 · handleSetupCreateStarterSheet({ context: "wizard" }) returns
          { ok: false, reason: "missing_client_id" } and does NOT open
          Settings. Every other caller is unchanged.
     C3 · continueWithGoogle checks the Client ID FIRST, opens the
          detour, focuses the paste field, and says one line.
   ============================================================ */

// ---------------------------------------------------------------
// C2 · the creator's missing-client-id branch
// ---------------------------------------------------------------

function loadSheetAccessSetup({ oauthClientId = "" } = {}) {
  const doc = makeFakeDocument();
  const win = {};
  const calls = [];
  const record = (name) => (...args) => {
    calls.push({ name, args });
  };
  const ctx = {
    window: win,
    document: doc,
    console: { warn() {}, error() {}, log() {} },
    setTimeout,
    clearTimeout,
    Object,
    Array,
    String,
    Number,
    Boolean,
    JSON,
    Date,
    Promise,
    Math,
    Error,
    fetch: async () => ({ ok: true, json: async () => ({}) }),
  };
  vm.createContext(ctx);
  vm.runInContext(readRepoFile("sheet-access-setup.js"), ctx, {
    filename: "sheet-access-setup.js",
  });
  win.JobBoredApp.core = {
    host: {
      getOAuthClientId: () => oauthClientId,
      showToast: record("showToast"),
      openCommandCenterSettingsModal: record("openCommandCenterSettingsModal"),
      getAccessToken: () => "",
      hasGrantedOauthScope: () => false,
      getGoogleSheetsScope: () => "sheets",
    },
    getGisLoaded: () => true,
    getTokenClient: () => ({}),
    setPendingSetupStarterSheetCreate: record("setPendingSetupStarterSheetCreate"),
  };
  return { win, calls, setup: win.JobBoredApp.setup };
}

describe("GREENFIELD C2 · the starter-sheet creator stops punting the wizard to Settings", () => {
  it("returns { ok: false, reason: 'missing_client_id' } for the wizard context", async () => {
    const env = loadSheetAccessSetup({ oauthClientId: "" });

    const result = await env.setup.handleSetupCreateStarterSheet({
      context: "wizard",
    });

    assert.ok(result, "the wizard needs an answer, not undefined");
    assert.equal(result.ok, false);
    assert.equal(result.reason, "missing_client_id");
  });

  it("never opens the Settings modal from the wizard context", async () => {
    const env = loadSheetAccessSetup({ oauthClientId: "" });

    await env.setup.handleSetupCreateStarterSheet({ context: "wizard" });

    assert.deepEqual(
      env.calls.filter((c) => c.name === "openCommandCenterSettingsModal"),
      [],
      "spec §4.4: Beat 1 owns this state — Settings is the punt F4 names",
    );
  });

  it("reports the missing Client ID through the wizard's own status line", async () => {
    const env = loadSheetAccessSetup({ oauthClientId: "" });
    const statuses = [];

    await env.setup.handleSetupCreateStarterSheet({
      context: "wizard",
      onStatus: (message, isError) => statuses.push([message, isError]),
    });

    assert.equal(statuses.length, 1, "the beat is told once, in the beat");
    assert.equal(statuses[0][1], true, "it is an error, and reads as one");
    assert.match(String(statuses[0][0]), /Client ID/i);
  });

  it("leaves the non-wizard path exactly as it was", async () => {
    const env = loadSheetAccessSetup({ oauthClientId: "" });

    await env.setup.handleSetupCreateStarterSheet({ context: "settings" });

    const names = env.calls.map((c) => c.name);
    assert.ok(
      names.includes("openCommandCenterSettingsModal"),
      "outside the flow, Settings is still where an OAuth client is saved",
    );
    assert.ok(names.includes("showToast"), "and the toast still explains why");
  });
});

// ---------------------------------------------------------------
// C3 · Beat 1's detour
// ---------------------------------------------------------------

const DETOUR_MESSAGE = "Paste your Client ID to continue.";

async function openBeatOne(hostState = {}) {
  const env = loadArrival();
  Object.assign(env.host.__state, hostState);
  await env.flow.open("google");
  return env;
}

/** The rendered detour node, found by the class renderDetour ships. */
function detour(env) {
  return env.mount().querySelector(".oneflow-google__detour");
}

function clientIdInput(env) {
  return env.mount().querySelector(".oneflow-google__client-id");
}

/** One macrotask — the tick the beat defers its focus onto. */
function tick() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("GREENFIELD C3 · Beat 1 with no Client ID opens its own detour", () => {
  it("does not sign in or create a sheet when the Client ID is missing", async () => {
    const env = await openBeatOne({ oauthClientId: "" });

    await env.beats.google.handleAction("google_continue");

    const names = env.host.__calls.map((c) => c.name);
    assert.ok(
      !names.includes("signIn"),
      "Google cannot sign anyone in without a client — asking is the dead end",
    );
    assert.ok(!names.includes("handleSetupCreateStarterSheet"));
  });

  it("renders the locked line in the message slot", async () => {
    const env = await openBeatOne({ oauthClientId: "" });

    await env.beats.google.handleAction("google_continue");

    assert.ok(
      renderedText(env.mount()).includes(DETOUR_MESSAGE),
      `spec §4.4 copy is locked: "${DETOUR_MESSAGE}"`,
    );
  });

  it("opens the detour <details> so the guide is on screen, not behind a summary", async () => {
    const env = await openBeatOne({ oauthClientId: "" });
    assert.equal(
      !!(detour(env) && detour(env).open),
      false,
      "it starts collapsed — the first-timer detour is opt-in",
    );

    await env.beats.google.handleAction("google_continue");

    const node = detour(env);
    assert.ok(node, "the detour still renders");
    assert.equal(node.open, true, "and it is now open");
  });

  it("focuses the Client ID paste field", async () => {
    const env = await openBeatOne({ oauthClientId: "" });

    await env.beats.google.handleAction("google_continue");
    await tick();

    const input = clientIdInput(env);
    assert.ok(input, "the paste field renders inside the detour");
    assert.equal(
      env.document.activeElement,
      input,
      "the caret lands where the next keystroke has to go",
    );
  });

  it("never opens the Settings modal", async () => {
    const env = await openBeatOne({ oauthClientId: "" });

    await env.beats.google.handleAction("google_continue");

    assert.deepEqual(
      env.host.__calls.filter(
        (c) => c.name === "openCommandCenterSettingsModal",
      ),
      [],
    );
  });

  it("behaves exactly as today once a Client ID is present", async () => {
    const env = await openBeatOne({
      oauthClientId: "client-123.apps.googleusercontent.com",
    });

    await env.beats.google.handleAction("google_continue");

    const names = env.host.__calls.map((c) => c.name);
    assert.ok(names.includes("signIn"));
    assert.ok(names.includes("handleSetupCreateStarterSheet"));
    assert.equal(env.flow.getState().beat, "ai", "B1 → B2, unchanged");
    assert.ok(
      !renderedText(env.mount()).includes(DETOUR_MESSAGE),
      "the detour line belongs to the missing-client state only",
    );
  });
});
