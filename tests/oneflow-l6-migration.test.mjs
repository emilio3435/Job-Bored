import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { loadCutover, settle } from "./oneflow-l6-harness.mjs";

/* ============================================================
   ONEFLOW L6 — migration (ONE-FLOW-ONBOARDING-SPEC §3.3).

   The spec's hardest constraint is a negative one: "Never re-onboard an
   existing user." Every row below is a legacy profile shape that exists
   on someone's machine today, and the claim is where boot drops them.

   These drive the REAL boot chain (runPostAccessBootstrapOnce) against
   the REAL store, so a row passes only when the shipped code routes it —
   not when a helper is spelled a particular way.
   ============================================================ */

/** A legacy discovery profile, as the profile wizard wrote it. */
const LEGACY_DISCOVERY_PROFILE = {
  targetRoles: "Staff Engineer, Principal Engineer",
  locations: "Austin, Denver",
  remotePolicy: "hybrid",
  seniority: "Staff",
};

async function boot(env) {
  await env.status.runPostAccessBootstrapOnce();
  await settle();
}

describe("§3.3 row 1 — a finished legacy user never sees the flow", () => {
  it("marks the flow completed and renders nothing", async () => {
    const env = loadCutover({ sheetId: "SHEET_1", signedIn: true });
    await env.store.completeInfraSetup();
    await env.store.completeOnboarding();

    await boot(env);

    assert.equal(env.openBeat(), "", "the flow must not render");
    assert.equal(
      env.flow.getState().completed,
      true,
      "the answer is recorded so the question is asked once",
    );
  });

  it("stays closed when discovery is incomplete — the banner carries that nudge", async () => {
    const env = loadCutover({ sheetId: "SHEET_1", signedIn: true });
    await env.store.completeInfraSetup();
    await env.store.completeOnboarding();
    assert.equal(await env.store.isDiscoverySetupComplete(), false);

    await boot(env);

    assert.equal(
      env.openBeat(),
      "",
      "an incomplete discovery is a nudge, never a re-onboarding",
    );
  });
});

describe("§3.3 row 2 — sheet configured only opens at B2", () => {
  it("routes a sheet-only legacy profile to the AI beat", async () => {
    const env = loadCutover({ sheetId: "SHEET_1", signedIn: true, config: {} });

    await boot(env);

    assert.equal(env.openBeat(), "ai");
  });

  it("routes a profile with NO sheet to B1 — the sheet is the substrate", async () => {
    const env = loadCutover({ sheetId: "", signedIn: true });

    await boot(env);

    assert.equal(env.openBeat(), "google");
  });

  it("does not spend a provider round-trip when no provider is configured", async () => {
    const env = loadCutover({ sheetId: "SHEET_1", signedIn: true, config: {} });

    await boot(env);

    assert.deepEqual(
      env.verifyCalls,
      [],
      "a keyless profile is B2's job; boot must not call the provider",
    );
  });
});

describe("§3.3 row 3 — a verified provider opens at B3", () => {
  it("routes past B2 when the configured provider answers", async () => {
    const env = loadCutover({
      sheetId: "SHEET_1",
      signedIn: true,
      config: { resumeProvider: "openrouter", resumeOpenRouterKey: "sk-x" },
    });

    await boot(env);

    assert.equal(env.verifyCalls.length, 1, "verified means actually checked");
    assert.equal(env.openBeat(), "resume");
  });

  it("keeps a configured-but-dead provider at B2", async () => {
    const env = loadCutover({
      sheetId: "SHEET_1",
      signedIn: true,
      config: { resumeProvider: "openrouter", resumeOpenRouterKey: "sk-dead" },
      verifyProvider: null,
    });

    await boot(env);

    assert.equal(
      env.openBeat(),
      "ai",
      "a key that no longer works is exactly what B2 exists to catch",
    );
  });
});

describe("§3.3 row 4 — a legacy profile with no server fit profile opens at B4", () => {
  it("routes to the fit beat and prefills it from the discovery profile", async () => {
    const env = loadCutover({
      sheetId: "SHEET_1",
      signedIn: true,
      serverProfile: null,
      config: { resumeProvider: "openrouter", resumeOpenRouterKey: "sk-x" },
    });
    await env.store.completeOnboarding();
    await env.store.saveDiscoveryProfile(LEGACY_DISCOVERY_PROFILE);

    await boot(env);

    assert.equal(env.openBeat(), "fit");
    const rendered = env.text();
    assert.match(
      rendered,
      /Staff Engineer/,
      "the roles the user already gave us must not be asked again",
    );
    assert.match(rendered, /Principal Engineer/);
    assert.match(rendered, /Austin/, "and neither must their locations");
  });

  it("goes to B3, not B4, once the server fit profile exists", async () => {
    const env = loadCutover({
      sheetId: "SHEET_1",
      signedIn: true,
      serverProfile: {
        identity: { targetRoles: ["Staff Engineer"], targetSeniority: "ic_staff" },
        strengths: [{ name: "Systems", rank: 1 }],
      },
      config: { resumeProvider: "openrouter", resumeOpenRouterKey: "sk-x" },
    });
    await env.store.completeOnboarding();

    await boot(env);

    assert.equal(
      env.openBeat(),
      "resume",
      "a saved fit profile means B4's one-time work is already done",
    );
  });
});

describe("§3.4 — resume beats migration", () => {
  it("a saved beat wins over the migration ladder on the next boot", async () => {
    const env = loadCutover({
      sheetId: "SHEET_1",
      signedIn: true,
      config: { resumeProvider: "openrouter", resumeOpenRouterKey: "sk-x" },
    });
    // The user got as far as B5 last session.
    await env.flow.goToBeat("discovery");
    await settle();
    env.flow.close("test-reset");

    await boot(env);

    assert.equal(
      env.openBeat(),
      "discovery",
      "refreshing mid-flow resumes the beat, it does not re-derive one",
    );
    assert.deepEqual(
      env.verifyCalls,
      [],
      "and a resume costs no migration round-trips",
    );
  });
});
