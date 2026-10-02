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
    assert.deepEqual(
      tab.gis.requests.map((r) => r.prompt),
      ["none"],
      "boot asks Google silently",
    );

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
    // The user pressed Sign in twice; the second window answered. Closing
    // the first, leftover window is no error.
    const tab = loadAuthTab(makeOrigin(), { sheetId: "sheet-1" });
    tab.auth.initAuth();
    const first = tab.auth.signIn();
    const second = tab.auth.signIn();
    tab.gis.reply({ access_token: "tok-2" });
    await flush();
    assert.deepEqual({ ...(await first) }, { ok: false, reason: "superseded" });
    assert.deepEqual({ ...(await second) }, { ok: true });
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

/* Round 2 (Astra's verdict): every reply is bound to the request that asked
   for it, and an op that ends ends for good. */

/** A settled-or-not probe that never hangs a red run. */
async function settledWithin(promise) {
  const marker = Symbol("pending");
  let value = marker;
  promise.then((v) => {
    value = v;
  });
  await flush();
  return value === marker ? "pending" : value;
}

describe("A3 · a sign-out ends every outstanding request (F1, F2)", () => {
  it("drops both late replies after a timed-out refresh, its retry, and a sign-out", async () => {
    const tab = loadAuthTab(makeOrigin(), { sheetId: "sheet-1" });
    tab.auth.initAuth();
    await signInInteractively(tab, "tok-1");

    const timedOut = tab.auth.refreshAccessTokenSilently();
    const timedOutRequest = tab.gis.requests.at(-1);
    await tab.clock.advance(25_000);
    assert.equal(await timedOut, false);
    void tab.auth.refreshAccessTokenSilently(); // the retry
    const retryRequest = tab.gis.requests.at(-1);
    assert.notEqual(retryRequest, timedOutRequest);

    tab.auth.signOut();
    await flush();
    tab.gis.replyTo(timedOutRequest, { access_token: "tok-late-1" });
    tab.gis.replyTo(retryRequest, { access_token: "tok-late-2" });
    await flush();

    assert.equal(tab.auth.isSignedIn(), false, "no reply signs the user back in");
    assert.equal(tab.auth.getAccessToken(), null);
    assert.equal(tab.sessionStorage.getItem(RUNTIME_KEY), null);
  });

  async function tabMidReconsent() {
    const origin = makeOrigin();
    const a = loadAuthTab(origin, { sheetId: "sheet-1" });
    const b = loadAuthTab(origin, { sheetId: "sheet-1" });
    a.auth.initAuth();
    b.auth.initAuth();
    await signInInteractively(a, "tok-a");
    await signInInteractively(b, "tok-b");
    const reconsent = b.auth.signIn({ prompt: "consent" });
    return { a, b, reconsent, reconsentRequest: b.gis.requests.at(-1) };
  }

  it("signs this tab out when another tab signs out during a re-consent, and the window closes", async () => {
    const { a, b, reconsent } = await tabMidReconsent();

    a.auth.signOut();
    await flush();
    assert.equal(b.auth.isSignedIn(), false, "tab B drops its old token at once");
    assert.equal(b.auth.getAccessToken(), null);
    assert.deepEqual({ ...(await settledWithin(reconsent)) }, { ok: false, reason: "cancelled" });

    b.gis.fail({ type: "popup_closed", message: "Popup window closed" });
    await flush();
    assert.equal(b.auth.isSignedIn(), false, "closing the window leaves tab B signed out");
    assert.equal(b.auth.getOauthPendingOp(), null);
  });

  it("keeps this tab signed out when the re-consent window answers after the sign-out", async () => {
    const { a, b, reconsentRequest } = await tabMidReconsent();

    a.auth.signOut();
    await flush();
    b.gis.replyTo(reconsentRequest, { access_token: "tok-b-new" });
    await flush();

    assert.equal(b.auth.isSignedIn(), false);
    assert.equal(b.sessionStorage.getItem(RUNTIME_KEY), null);
  });
});

describe("A17 · a late restore never answers a newer sign-in (F4)", () => {
  it("drops the old restore's token and waits for the sign-in's own", async () => {
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
    const restoreRequest = tab.gis.requests.at(-1);
    await tab.clock.advance(8_000);
    const attempt = tab.auth.signIn();

    tab.gis.replyTo(restoreRequest, { access_token: "tok-late-restore" });
    await flush();

    assert.equal(await settledWithin(attempt), "pending", "the sign-in still waits for its window");
    assert.equal(tab.auth.isSignedIn(), false);
    assert.equal(tab.toasts.some((t) => t.message === "Signed in"), false);

    tab.gis.reply({ access_token: "tok-signin" });
    await flush();
    assert.deepEqual({ ...(await attempt) }, { ok: true });
    assert.equal(tab.auth.getAccessToken(), "tok-signin");
  });
});

describe("A1/A6 · a refresh during a sign-in waits for it (F5)", () => {
  async function reconsentThenRefresh() {
    const tab = loadAuthTab(makeOrigin(), { sheetId: "sheet-1" });
    tab.auth.initAuth();
    await signInInteractively(tab, "tok-1");
    const attempt = tab.auth.signIn({ prompt: "consent" });
    const before = tab.gis.requests.length;
    const refresh = tab.auth.refreshAccessTokenSilently();
    assert.equal(tab.gis.requests.length, before, "no silent request over the open sign-in");
    return { tab, attempt, refresh };
  }

  it("settles both when the window closes", async () => {
    const { tab, attempt, refresh } = await reconsentThenRefresh();
    tab.gis.fail({ type: "popup_closed", message: "Popup window closed" });
    await flush();
    assert.deepEqual({ ...(await settledWithin(attempt)) }, { ok: false, reason: "popup_closed" });
    assert.equal(await settledWithin(refresh), false);
  });

  it("settles both with the new token when the window signs in", async () => {
    const { tab, attempt, refresh } = await reconsentThenRefresh();
    tab.gis.reply({ access_token: "tok-2" });
    await flush();
    assert.deepEqual({ ...(await settledWithin(attempt)) }, { ok: true });
    assert.equal(await settledWithin(refresh), true);
    assert.equal(tab.auth.getAccessToken(), "tok-2");
  });
});

describe("A1/A6 · a sign-in during a 401 refresh survives the 401 caller", () => {
  it("keeps the sign-in open when the Sheets caller clears the session", async () => {
    const tab = loadAuthTab(makeOrigin(), { sheetId: "sheet-1" });
    tab.auth.initAuth();
    await signInInteractively(tab, "tok-1");
    const caller = sheetsCallerOn401(tab);
    const attempt = tab.auth.signIn();

    assert.equal(await caller, false, "signIn() ends the refresh in flight");
    assert.equal(await settledWithin(attempt), "pending", "the 401 caller does not cancel it");

    tab.gis.reply({ access_token: "tok-2" });
    await flush();
    assert.deepEqual({ ...(await attempt) }, { ok: true });
    assert.equal(tab.auth.isSignedIn(), true);
    assert.equal(tab.auth.getAccessToken(), "tok-2");
  });
});

/* Round 3 (Grok's verdict): GIS's error_callback carries no state, so an
   error from a written-off window must not settle the op now current; and
   a wait on an open sign-in has a deadline. */

describe("A6 · an error from a written-off request leaves the current sign-in alone (P1)", () => {
  it("lets the second sign-in finish after the first window closes", async () => {
    const tab = loadAuthTab(makeOrigin(), { sheetId: "sheet-1" });
    tab.auth.initAuth();
    const first = tab.auth.signIn();
    const firstRequest = tab.gis.requests.at(-1);
    const second = tab.auth.signIn();

    tab.gis.failTo(firstRequest, { type: "popup_closed", message: "Popup window closed" });
    assert.equal(await settledWithin(second), "pending", "the first window's closing is not the second's");

    tab.gis.reply({ access_token: "tok-2" });
    await flush();
    assert.deepEqual({ ...(await first) }, { ok: false, reason: "superseded" });
    assert.deepEqual({ ...(await second) }, { ok: true });
    assert.equal(tab.auth.getAccessToken(), "tok-2");
  });

  it("lets a sign-in finish after the refresh it replaced reports an error", async () => {
    const tab = loadAuthTab(makeOrigin(), { sheetId: "sheet-1" });
    tab.auth.initAuth();
    await signInInteractively(tab, "tok-1");
    void tab.auth.refreshAccessTokenSilently();
    const refreshRequest = tab.gis.requests.at(-1);
    const attempt = tab.auth.signIn();

    tab.gis.failTo(refreshRequest, { type: "unknown", message: "prompt=none failed" });
    assert.equal(await settledWithin(attempt), "pending", "the refresh's error is not the sign-in's");

    tab.gis.reply({ access_token: "tok-2" });
    await flush();
    assert.deepEqual({ ...(await attempt) }, { ok: true });
  });

  it("still ends a lone sign-in when its own window closes", async () => {
    const tab = loadAuthTab(makeOrigin(), { sheetId: "sheet-1" });
    tab.auth.initAuth();
    await signInInteractively(tab, "tok-1");
    const attempt = tab.auth.signIn({ prompt: "consent" });
    tab.gis.fail({ type: "popup_closed", message: "Popup window closed" });
    assert.deepEqual({ ...(await settledWithin(attempt)) }, { ok: false, reason: "popup_closed" });
  });
});

describe("A1 · a 401 caller's wait on an open sign-in has a deadline (P2)", () => {
  it("answers false after 25 s and leaves the sign-in open", async () => {
    const tab = loadAuthTab(makeOrigin(), { sheetId: "sheet-1" });
    tab.auth.initAuth();
    await signInInteractively(tab, "tok-1");
    const attempt = tab.auth.signIn({ prompt: "consent" });
    const refresh = tab.auth.refreshAccessTokenSilently();

    await tab.clock.advance(25_000);
    assert.equal(await settledWithin(refresh), false, "the caller is not held by an open window");
    assert.equal(await settledWithin(attempt), "pending");
    assert.equal(tab.auth.getOauthPendingOp()?.kind, "interactive", "the sign-in stays open");

    tab.gis.reply({ access_token: "tok-2" });
    await flush();
    assert.deepEqual({ ...(await attempt) }, { ok: true });
  });
});

describe("A3 · a window that closes after a remote sign-out is quiet (P2)", () => {
  it("shows no error toast", async () => {
    const origin = makeOrigin();
    const a = loadAuthTab(origin, { sheetId: "sheet-1" });
    const b = loadAuthTab(origin, { sheetId: "sheet-1" });
    a.auth.initAuth();
    b.auth.initAuth();
    await signInInteractively(a, "tok-a");
    await signInInteractively(b, "tok-b");
    void b.auth.signIn({ prompt: "consent" });
    a.auth.signOut();
    await flush();
    const before = b.toasts.length;

    b.gis.fail({ type: "popup_closed", message: "Popup window closed" });
    await flush();

    assert.deepEqual(b.toasts.slice(before), [], "the session already ended; nothing to report");
    assert.equal(b.auth.isSignedIn(), false);
  });
});

/* Round 4 (Grok's r3 verdict): one GIS token client per request, so an
   error is bound to the request that made it — Grok's exact orderings. */

describe("A6 · every error reaches only its own request (r3 P1)", () => {
  it("a timed-out refresh's late error leaves a newer sign-in alone", async () => {
    const tab = loadAuthTab(makeOrigin(), { sheetId: "sheet-1" });
    tab.auth.initAuth();
    await signInInteractively(tab, "tok-1");
    const refresh = tab.auth.refreshAccessTokenSilently();
    const refreshRequest = tab.gis.requests.at(-1);
    await tab.clock.advance(25_000);
    assert.equal(await refresh, false, "the refresh left the pending op");
    const attempt = tab.auth.signIn();

    tab.gis.failTo(refreshRequest, { type: "unknown", message: "prompt=none failed" });
    assert.equal(await settledWithin(attempt), "pending", "not the sign-in's error");

    tab.gis.reply({ access_token: "tok-2" });
    await flush();
    assert.deepEqual({ ...(await attempt) }, { ok: true });
  });

  it("a timed-out restore's late error leaves a newer sign-in alone", async () => {
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
    const restoreRequest = tab.gis.requests.at(-1);
    await tab.clock.advance(8_000);
    const attempt = tab.auth.signIn();
    const before = tab.toasts.length;

    tab.gis.failTo(restoreRequest, { type: "popup_failed_to_open", message: "Failed to open popup window" });
    assert.equal(await settledWithin(attempt), "pending", "not the sign-in's error");
    assert.deepEqual(tab.toasts.slice(before), [], "no toast for an ended restore");

    tab.gis.reply({ access_token: "tok-2" });
    await flush();
    assert.deepEqual({ ...(await attempt) }, { ok: true });
  });

  it("the current sign-in's own closed window ends it while an older request is still out", async () => {
    const tab = loadAuthTab(makeOrigin(), { sheetId: "sheet-1" });
    tab.auth.initAuth();
    const first = tab.auth.signIn();
    const firstRequest = tab.gis.requests.at(-1);
    const second = tab.auth.signIn();

    tab.gis.fail({ type: "popup_closed", message: "Popup window closed" });
    assert.deepEqual({ ...(await settledWithin(second)) }, { ok: false, reason: "popup_closed" });
    assert.deepEqual({ ...(await first) }, { ok: false, reason: "superseded" });

    tab.gis.replyTo(firstRequest, { access_token: "tok-old" });
    await flush();
    assert.equal(tab.auth.isSignedIn(), false, "the written-off window's token is dropped");
  });

  it("the current sign-in's own failure to open ends it after a refresh it replaced", async () => {
    const tab = loadAuthTab(makeOrigin(), { sheetId: "sheet-1" });
    tab.auth.initAuth();
    await signInInteractively(tab, "tok-1");
    void tab.auth.refreshAccessTokenSilently();
    const attempt = tab.auth.signIn();

    tab.gis.fail({ type: "popup_failed_to_open", message: "Failed to open popup window" });
    assert.deepEqual(
      { ...(await settledWithin(attempt)) },
      { ok: false, reason: "popup_failed_to_open" },
    );
  });
});
