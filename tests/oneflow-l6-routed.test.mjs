import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { loadAuthSession, loadCutover, settle } from "./oneflow-l6-harness.mjs";

/* ============================================================
   ONEFLOW L6 — the two cross-fence needs L4 routed here.

   1. B6's headline is "You're live, {firstName}." (spec §5 B6). Nothing
      in the app had ever read Google's given_name, so the happy path was
      always the comma-less fallback. auth-session.js keeps it now, B1
      carries it on the flow runtime, and B6 spends no second round trip.

   2. B6's "Your search" card prefers the profile the flow just saved over
      a second /profile fetch. B4 has to leave it on the runtime for that
      preference to mean anything.
   ============================================================ */

const USERINFO = {
  email: "priya@example.com",
  given_name: "Priya",
  picture: "https://example.com/priya.png",
};

describe("routed 6 · auth-session keeps Google's given name", () => {
  it("captures given_name from /oauth2/v3/userinfo", async () => {
    const env = loadAuthSession({ userInfo: USERINFO });
    env.auth.setAccessToken("token-abc");
    await env.auth.fetchUserEmail();

    assert.equal(env.auth.getUserGivenName(), "Priya");
    assert.equal(env.auth.getUserEmail(), "priya@example.com");
  });

  it("has no name when Google returns none — never a fabricated one", async () => {
    const env = loadAuthSession({
      userInfo: { email: "nobody@example.com" },
    });
    env.auth.setAccessToken("token-abc");
    await env.auth.fetchUserEmail();

    assert.equal(env.auth.getUserGivenName(), null);
  });

  it("persists the name beside the other session fields", async () => {
    const env = loadAuthSession({ userInfo: USERINFO });
    env.auth.setAccessToken("token-abc");
    env.auth.setTokenExpiresAt(Date.now() + 3600_000);
    await env.auth.fetchUserEmail();

    const marker = JSON.parse(
      env.localStorage.getItem("command_center_oauth_session"),
    );
    const runtime = JSON.parse(
      env.sessionStorage.getItem("command_center_oauth_runtime"),
    );
    assert.equal(marker.userGivenName, "Priya");
    assert.equal(runtime.userGivenName, "Priya");
    assert.equal(
      marker.accessToken,
      undefined,
      "and the bearer token still never lands in localStorage",
    );
  });

  it("restores the name from a persisted runtime session", async () => {
    const env = loadAuthSession({ userInfo: USERINFO });
    env.auth.setAccessToken("token-abc");
    env.auth.setTokenExpiresAt(Date.now() + 3600_000);
    await env.auth.fetchUserEmail();
    const stored = env.auth.loadPersistedRuntimeOAuthSession();

    assert.equal(
      stored.userGivenName,
      "Priya",
      "a refresh in the same tab must not lose the name",
    );
  });

  it("clears the name with the rest of the session", async () => {
    const env = loadAuthSession({ userInfo: USERINFO });
    env.auth.setAccessToken("token-abc");
    await env.auth.fetchUserEmail();
    env.auth.clearSessionAuthState();

    assert.equal(env.auth.getUserGivenName(), null);
  });
});

/**
 * B6's resolved headline reaches the user through the celebration
 * player's title (oneflow-beat-payoff.js:418) — recording the player is
 * how a probe reads the headline the flow actually produced.
 */
function recordCelebration(env) {
  const titles = [];
  env.window.JobBoredOnboardingCelebration = {
    STAGES: { flow_payoff: {} },
    playOnboardingCelebration(done, stage, options) {
      titles.push((options && options.title) || "");
      if (typeof done === "function") done();
    },
  };
  return titles;
}

describe("routed 6 · B1 carries the name to B6 on the flow runtime", () => {
  it('B6 says "You\'re live, {firstName}." from what B1 wrote', async () => {
    const env = loadCutover({ sheetId: "", signedIn: false, givenName: "Priya" });
    await env.flow.open("google");
    await settle();

    await env.act("google_continue");
    await settle();

    const titles = recordCelebration(env);
    // The accessor is gone now — only the runtime can still answer.
    env.window.JobBoredApp.auth.getUserGivenName = () => "";
    await env.flow.goToBeat("payoff");
    await settle();

    assert.deepEqual(titles, ["You're live, Priya."]);
  });

  it("falls back to the comma-less headline when Google gave no name", async () => {
    const env = loadCutover({ sheetId: "", signedIn: false, givenName: "" });
    await env.flow.open("google");
    await settle();
    await env.act("google_continue");
    await settle();

    const titles = recordCelebration(env);
    await env.flow.goToBeat("payoff");
    await settle();

    assert.deepEqual(
      titles,
      ["You're live."],
      "an empty name must drop the comma, not ship a dangling one",
    );
  });
});

/** A B3 draft that clears every one of B4's validation gates. */
const READY_DRAFT = {
  version: 1,
  identity: {
    targetRoles: ["Staff Engineer"],
    targetSeniority: "ic_staff",
    primaryNarrative:
      "I build reliable platform systems other teams ship on top of.",
  },
  strengths: [{ name: "Distributed systems", rank: 1 }],
  hardConstraints: {
    workMode: "hybrid_ok",
    acceptableLocations: ["Austin"],
    salaryFloor: 185000,
  },
};

describe("routed 7 · B4 leaves the saved profile on the runtime", () => {
  it("B6 renders the just-saved search without a second /profile fetch", async () => {
    const env = loadCutover({
      sheetId: "SHEET_1",
      signedIn: true,
      serverProfile: null,
    });
    env.flow.seedRuntime({ profileDraft: READY_DRAFT });
    await env.flow.goToBeat("fit");
    await settle();

    await env.act("confirm-fit");
    await settle();

    const beforePayoff = env.fetchCalls.filter(
      (c) => /\/profile$/.test(c.url) && c.method === "GET",
    ).length;

    await env.flow.goToBeat("payoff");
    await settle();

    assert.match(env.text(), /Staff Engineer/, "B6 shows the saved search");
    assert.match(env.text(), /Austin/);
    assert.equal(
      env.fetchCalls.filter(
        (c) => /\/profile$/.test(c.url) && c.method === "GET",
      ).length,
      beforePayoff,
      "the in-flow profile is preferred over a second GET /profile",
    );
  });

  it("still falls back to GET /profile when the flow carries nothing", async () => {
    const env = loadCutover({
      sheetId: "SHEET_1",
      signedIn: true,
      serverProfile: {
        identity: { targetRoles: ["Design Systems Lead"] },
        strengths: [{ name: "Design systems", rank: 1 }],
        hardConstraints: { acceptableLocations: ["Remote — US"] },
      },
    });
    await env.flow.goToBeat("payoff");
    await settle();

    assert.match(env.text(), /Design Systems Lead/);
  });
});
