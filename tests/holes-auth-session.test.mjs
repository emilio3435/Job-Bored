import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CLIENT_ID,
  flush,
  loadAuthTab,
  makeOrigin,
  signInInteractively,
} from "./holes-auth-harness.mjs";

/* ============================================================
   HOLES AUTH — the Google session holds across 401s, timeouts and tabs.

   A1  two 401s at once must not orphan a refresh into a false sign-out;
   A7  a refresh that times out must not wedge the wake-up refresh;
   A17 a token that arrives after the restore wait is a restore;
   A3  signing out in one tab signs out every tab (jb-session);
   A6  closing Google's window ends an interactive sign-in at once;
   §0.7 the access token never reaches localStorage (a guard).

   All against the real auth-session.js, booted through initAuth()
   with a fake Google Identity Services client and a hand-driven clock.
   ============================================================ */

const RUNTIME_KEY = "command_center_oauth_runtime";
const MARKER_KEY = "command_center_oauth_session";

/** The 401 contract every Sheets caller follows: refresh once, else end the session. */
function sheetsCallerOn401(tab) {
  return (async () => {
    const ok = await tab.auth.refreshAccessTokenSilently();
    if (!ok) tab.auth.clearSessionAuthState();
    return ok;
  })();
}

describe("A1 · concurrent 401s share one silent refresh", () => {
  it("ends with the user still signed in, on the new token, after one Google request", async () => {
    const tab = loadAuthTab(makeOrigin(), { sheetId: "sheet-1" });
    tab.auth.initAuth();
    await signInInteractively(tab, "tok-1");
    const before = tab.gis.requests.length;

    const first = sheetsCallerOn401(tab);
    const second = sheetsCallerOn401(tab);
    assert.equal(tab.gis.requests.length - before, 1, "both callers wait on one request");
    assert.equal(tab.gis.requests.at(-1).prompt, "none");

    tab.gis.reply({ access_token: "tok-2" });
    // Past every refresh deadline: an orphaned waiter would answer false here.
    await tab.clock.advance(60_000);

    assert.deepEqual(await Promise.all([first, second]), [true, true]);
    assert.equal(tab.auth.isSignedIn(), true, "no false sign-out");
    assert.equal(tab.auth.getAccessToken(), "tok-2");
  });

  it("starts a fresh request once the shared one has settled", async () => {
    const tab = loadAuthTab(makeOrigin());
    tab.auth.initAuth();
    await signInInteractively(tab, "tok-1");

    const first = tab.auth.refreshAccessTokenSilently();
    tab.gis.reply({ access_token: "tok-2" });
    assert.equal(await first, true);

    const before = tab.gis.requests.length;
    const next = tab.auth.refreshAccessTokenSilently();
    assert.equal(tab.gis.requests.length, before + 1, "a settled refresh is not reused");
    tab.gis.reply({ access_token: "tok-3" });
    assert.equal(await next, true);
    assert.equal(tab.auth.getAccessToken(), "tok-3");
  });
});

describe("A7 · a timed-out refresh clears the pending operation", () => {
  it("lets the wake-from-sleep refresh run after Google never answered", async () => {
    const tab = loadAuthTab(makeOrigin());
    tab.auth.initAuth();
    tab.auth.setAccessToken("tok-1");
    tab.auth.setTokenExpiresAt(tab.clock.now() + 120_000);

    const refresh = tab.auth.refreshAccessTokenSilently();
    await tab.clock.advance(25_000);
    assert.equal(await refresh, false);
    assert.equal(tab.auth.getOauthPendingOp(), null, "the timeout ends the op");

    const before = tab.gis.requests.length;
    await tab.becomeVisible();
    assert.equal(tab.gis.requests.length, before + 1, "the wake refresh is not blocked");
    assert.equal(tab.gis.requests.at(-1).prompt, "none");
  });

  it("still accepts the late answer quietly, as a refresh", async () => {
    const tab = loadAuthTab(makeOrigin(), { sheetId: "sheet-1" });
    tab.auth.initAuth();
    await signInInteractively(tab, "tok-1");
    const toastsBefore = tab.toasts.length;
    const loadsBefore = tab.callsTo("loadAllData").length;

    const refresh = tab.auth.refreshAccessTokenSilently();
    await tab.clock.advance(25_000);
    assert.equal(await refresh, false);
    tab.gis.reply({ access_token: "tok-late" });
    await flush();

    assert.equal(tab.auth.getAccessToken(), "tok-late");
    assert.deepEqual(tab.toasts.slice(toastsBefore), [], "no 'Signed in' for a refresh");
    assert.equal(tab.callsTo("loadAllData").length, loadsBefore, "a refresh reloads nothing");
  });
});

describe("A17 · a token after the restore timeout is a restore", () => {
  it("restores quietly instead of replaying an interactive sign-in", async () => {
    const origin = makeOrigin();
    origin.localStorage.setItem(
      MARKER_KEY,
      JSON.stringify({
        hasOauthSession: true,
        expiresAt: Date.UTC(2026, 9, 2, 13, 0, 0),
        oauthClientId: CLIENT_ID,
        userEmail: "user@example.com",
      }),
    );
    const tab = loadAuthTab(origin, { sheetId: "sheet-1" });
    tab.auth.initAuth();
    assert.deepEqual(tab.gis.requests, [{ prompt: "none" }], "boot asks Google silently");

    await tab.clock.advance(8_000);
    assert.deepEqual(tab.gateModes(), ["signin"], "the restore wait ran out");

    tab.gis.reply({ access_token: "tok-late" });
    await flush();

    assert.equal(tab.auth.isSignedIn(), true);
    assert.equal(
      tab.toasts.some((t) => t.message === "Signed in"),
      false,
      "no interactive 'Signed in' toast",
    );
    assert.equal(
      tab.window.__expiredReviewArmFromInteractiveSignin,
      undefined,
      "the interactive-only expired-review auto-open stays unarmed",
    );
    assert.deepEqual(tab.gateModes(), ["signin"], "no interactive 'loading' gate");
    assert.equal(tab.callsTo("loadAllData").length, 1);
    assert.equal(tab.callsTo("revealDashboardShell").length, 1);
  });
});

describe("A3 · sign-out reaches every open tab over jb-session", () => {
  async function twoSignedInTabs() {
    const origin = makeOrigin();
    const a = loadAuthTab(origin, { sheetId: "sheet-1" });
    const b = loadAuthTab(origin, { sheetId: "sheet-1" });
    a.auth.initAuth();
    b.auth.initAuth();
    await signInInteractively(a, "tok-a");
    await signInInteractively(b, "tok-b");
    return { origin, a, b };
  }

  it("signs the other tab out, drops its token, and gates it", async () => {
    const { origin, a, b } = await twoSignedInTabs();
    assert.ok(b.sessionStorage.getItem(RUNTIME_KEY), "tab B holds its own token");

    a.auth.signOut();
    await flush();

    assert.equal(b.auth.isSignedIn(), false);
    assert.equal(b.sessionStorage.getItem(RUNTIME_KEY), null);
    assert.ok(b.gateModes().includes("signin"));
    assert.ok(b.callsTo("setPipelineData").length > 0, "tab B wipes the loaded pipeline");
    assert.ok(
      b.toasts.some((t) => /another tab/i.test(t.message)),
      "tab B says why it signed out",
    );
    assert.ok(
      origin.posted.some((p) => p.name === "jb-session"),
      "the sign-out travels on jb-session",
    );
  });

  it("drops a silent reply the other tab was still waiting for", async () => {
    const { a, b } = await twoSignedInTabs();
    void b.auth.refreshAccessTokenSilently();

    a.auth.signOut();
    await flush();
    b.gis.reply({ access_token: "tok-b-late" });
    await flush();

    assert.equal(b.auth.isSignedIn(), false, "tab B does not sign itself back in");
    assert.equal(b.sessionStorage.getItem(RUNTIME_KEY), null);
  });

  it("keeps a cleared session cleared when a reply it abandoned arrives (Clear settings)", async () => {
    const origin = makeOrigin();
    const tab = loadAuthTab(origin, { sheetId: "sheet-1" });
    tab.auth.initAuth();
    await signInInteractively(tab, "tok-1");
    void tab.auth.refreshAccessTokenSilently(); // a 401 retry's refresh, in flight

    tab.auth.clearSessionAuthState(); // settings-modal.js "Clear settings" calls this directly
    tab.gis.reply({ access_token: "tok-abandoned" });
    await flush();

    assert.equal(tab.auth.isSignedIn(), false, "the abandoned reply does not sign back in");
    assert.equal(tab.sessionStorage.getItem(RUNTIME_KEY), null);
    assert.equal(origin.localStorage.getItem(MARKER_KEY), null);
  });

  it("never puts the token or the email on the channel", async () => {
    const { origin, a } = await twoSignedInTabs();
    a.auth.signOut();
    await flush();
    const wire = JSON.stringify(origin.posted);
    assert.equal(wire.includes("tok-"), false);
    assert.equal(wire.includes("user@example.com"), false);
  });
});

describe("A6 · closing Google's window ends the sign-in at once", () => {
  it("settles signIn() with popup_closed and clears the pending op", async () => {
    const tab = loadAuthTab(makeOrigin());
    tab.auth.initAuth();
    const attempt = tab.auth.signIn();
    assert.equal(typeof (attempt && attempt.then), "function", "signIn() answers with a promise");

    tab.gis.fail({ type: "popup_closed", message: "Popup window closed" });

    assert.deepEqual({ ...(await attempt) }, { ok: false, reason: "popup_closed" });
    assert.equal(tab.auth.getOauthPendingOp(), null);
  });

  it("says the window closed, not that it couldn't open", async () => {
    const tab = loadAuthTab(makeOrigin());
    tab.auth.initAuth();
    void tab.auth.signIn();
    tab.gis.fail({ type: "popup_closed", message: "Popup window closed" });
    const last = tab.toasts.at(-1).message;
    assert.match(last, /popup/i);
    assert.match(last, /closed/i);
    assert.doesNotMatch(last, /couldn.t open/i);
  });

  it("stays quiet when the window closes after its sign-in already finished", async () => {
    // The restore wait ran out, the user pressed Sign in, and the late
    // silent token answered first; closing the leftover window is no error.
    const origin = makeOrigin();
    origin.localStorage.setItem(
      MARKER_KEY,
      JSON.stringify({
        hasOauthSession: true,
        expiresAt: Date.UTC(2026, 9, 2, 13, 0, 0),
        oauthClientId: CLIENT_ID,
      }),
    );
    const tab = loadAuthTab(origin, { sheetId: "sheet-1" });
    tab.auth.initAuth();
    await tab.clock.advance(8_000);
    void tab.auth.signIn();
    tab.gis.reply({ access_token: "tok-late-restore" });
    await flush();
    assert.equal(tab.auth.isSignedIn(), true);
    const before = tab.toasts.length;

    tab.gis.fail({ type: "popup_closed", message: "Popup window closed" });

    assert.deepEqual(tab.toasts.slice(before), [], "no error toast on a signed-in tab");
    assert.equal(tab.auth.isSignedIn(), true);
  });

  it("settles a successful sign-in with ok:true", async () => {
    const tab = loadAuthTab(makeOrigin());
    tab.auth.initAuth();
    assert.deepEqual({ ...(await signInInteractively(tab, "tok-1")) }, { ok: true });
  });
});

describe("§0.7 guard · the access token never reaches localStorage", () => {
  it("holds across sign-in, refresh, a late restore and sign-out", async () => {
    const origin = makeOrigin();
    const a = loadAuthTab(origin, { sheetId: "sheet-1" });
    a.auth.initAuth();
    await signInInteractively(a, "tok-secret-1");
    const refresh = a.auth.refreshAccessTokenSilently();
    a.gis.reply({ access_token: "tok-secret-2" });
    await refresh;

    // A second tab restores through the marker, late.
    const b = loadAuthTab(origin, { sheetId: "sheet-1" });
    b.auth.initAuth();
    await b.clock.advance(8_000);
    b.gis.reply({ access_token: "tok-secret-3" });
    await flush();
    a.auth.signOut();
    await flush();

    assert.ok(origin.localStorage.writes.length > 0, "the marker was written");
    for (const [key, value] of origin.localStorage.writes) {
      assert.equal(value.includes("tok-secret"), false, `localStorage[${key}] holds a token`);
    }
    assert.equal(origin.localStorage.getItem(RUNTIME_KEY), null);
  });
});
