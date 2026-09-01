import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { loadCutover, readRepoFile, settle } from "./oneflow-l6-harness.mjs";

/* ============================================================
   ONEFLOW L6 — the boot cutover.

   Two edits carry the whole flow into production:

     1. app-bootstrap.js init() — a cold start with no sheet opens the
        PRODUCT (the S0 demo board, spec §4) instead of asking a stranger
        for a Google client id. The gate's `error` mode is untouched.
     2. discovery-status-handoff.js runPostAccessBootstrapOnce() — the
        post-auth chain runs JobBoredOneFlow.maybeStart() instead of the
        two legacy gates (spec §3.3 / §3.4).

   Everything here drives the real modules in one vm page, so "the boot
   chain calls the flow" is asserted as behavior, not as a regex. The one
   deliberate source assertion is the grep table the DoD asks for: the
   legacy gates must still EXIST (L7 deletes them) while no longer being
   reachable from boot.
   ============================================================ */

describe("L6 · cold start opens the demo board, not a credential ask (spec §4)", () => {
  it("mounts S0 when no sheet is configured", async () => {
    const env = loadCutover({ sheetId: "" });
    env.bootstrap.init();
    await settle();

    assert.equal(env.board.isActive(), true, "S0 must be the cold-start surface");
    const gateModes = env.calls
      .filter((c) => c.name === "showSheetAccessGate")
      .map((c) => c.args[0]);
    assert.deepEqual(
      gateModes,
      [],
      "the credential-first no-oauth/loading opening is what §4 deletes",
    );
  });

  it("mounts S0 even with no OAuth client id — §4 deletes the no-oauth opening", async () => {
    const env = loadCutover({ sheetId: "", oauthClientId: "" });
    env.bootstrap.init();
    await settle();

    assert.equal(env.board.isActive(), true);
    assert.equal(
      env.called().includes("showSheetAccessGate"),
      false,
      "a keyless visitor sees the board first; the client id is B1's ask",
    );
  });

  it("still wires initAuth so Beat 1's Continue with Google works", async () => {
    const env = loadCutover({ sheetId: "" });
    env.bootstrap.init();
    await settle();

    assert.equal(
      env.called().includes("initAuth"),
      true,
      "B1 signs in through the same auth wiring the gate used",
    );
  });

  it("keeps the gate's error mode for a genuinely broken config (spec §4)", async () => {
    const env = loadCutover({ sheetId: "", gateMode: "error" });
    env.bootstrap.init();
    await settle();

    assert.equal(
      env.board.isActive(),
      false,
      "a demo board painted over a real error hides the error",
    );
    assert.equal(
      env.document.getElementById("sheetAccessGateScreen").dataset.gateMode,
      "error",
      "the error gate stays exactly as it was",
    );
    assert.equal(
      env.called().includes("showSheetAccessGate"),
      false,
      "and boot must not overwrite it with loading/no-oauth",
    );
  });

  it("falls back to the login gate when the demo board module is missing", async () => {
    const env = loadCutover({ sheetId: "" });
    delete env.window.JobBoredOneFlowDemoBoard;
    env.bootstrap.init();
    await settle();

    const gateModes = env.calls
      .filter((c) => c.name === "showSheetAccessGate")
      .map((c) => c.args[0]);
    assert.deepEqual(
      gateModes,
      ["loading"],
      "a stranger must still be able to sign in if S0 failed to load",
    );
  });

  it("no longer runs the legacy infra gate on the cold-start path", async () => {
    const env = loadCutover({ sheetId: "" });
    env.bootstrap.init();
    await settle();

    assert.equal(
      env.called().includes("checkInfraSetupGate"),
      false,
      "the first-run infra wizard is not the cold-start surface any more",
    );
  });
});

describe("L6 · the post-auth chain runs the flow, not the legacy gates (spec §3.3)", () => {
  it("calls JobBoredOneFlow.maybeStart instead of the two gates", async () => {
    const env = loadCutover({ sheetId: "SHEET_1", signedIn: true });
    await env.status.runPostAccessBootstrapOnce();
    await settle();

    assert.equal(
      env.called().includes("checkInfraSetupGate"),
      false,
      "checkInfraSetupGate is no longer called from boot",
    );
    assert.equal(
      env.called().includes("checkOnboardingGate"),
      false,
      "checkOnboardingGate is no longer called from boot",
    );
    const state = env.flow.getState();
    assert.ok(state.startedAt, "maybeStart must have opened the deal");
  });

  it("stays one-shot: a second call does not re-open the flow", async () => {
    const env = loadCutover({ sheetId: "SHEET_1", signedIn: true });
    await env.status.runPostAccessBootstrapOnce();
    await settle();
    const first = env.openBeat();
    await env.status.runPostAccessBootstrapOnce();
    await settle();

    assert.equal(env.openBeat(), first, "the beat must not restart");
  });

  it("does not re-open a flow the S0 card already opened (spec §3.4)", async () => {
    const env = loadCutover({ sheetId: "", signedIn: true });
    await env.flow.open();
    await settle();
    assert.equal(env.openBeat(), "google");

    await env.flow.goToBeat("ai");
    await settle();
    await env.status.runPostAccessBootstrapOnce();
    await settle();

    assert.equal(
      env.openBeat(),
      "ai",
      "boot must not yank an open flow back to its entry beat",
    );
  });

  it("still surfaces a stored terminal run outcome after the cutover", async () => {
    // The rest of runPostAccessBootstrapOnce is load-bearing: swapping the
    // gates for the flow must not cost the stored-outcome resume.
    const env = loadCutover({
      sheetId: "SHEET_1",
      signedIn: true,
      trackerState: {
        status: "failed",
        runId: "run_abc12345",
        statusPath: "/runs/run_abc12345",
        errorMessage: "Worker exploded mid-run",
        terminalAcknowledged: false,
      },
    });
    await env.status.runPostAccessBootstrapOnce();
    await settle();

    const toasts = env.calls.filter((c) => c.name === "showToast");
    assert.equal(toasts.length, 1, "the stored terminal outcome still toasts");
    assert.match(String(toasts[0].args[0]), /Worker exploded mid-run/);
    assert.deepEqual(env.acknowledged, ["failed"]);
  });
});

describe("L6 · grep table — the legacy gates are defined but unreachable from boot", () => {
  const bootFiles = ["app-bootstrap.js", "discovery-status-handoff.js"];

  for (const file of bootFiles) {
    it(`${file} no longer calls checkInfraSetupGate / checkOnboardingGate`, () => {
      const source = readRepoFile(file);
      assert.equal(
        /checkInfraSetupGate/.test(source),
        false,
        `${file} must not call the legacy infra gate`,
      );
      assert.equal(
        /checkOnboardingGate/.test(source),
        false,
        `${file} must not call the legacy onboarding gate`,
      );
    });

  }

  it("app-bootstrap.js opens the cold start on the demo board", () => {
    assert.ok(
      /JobBoredOneFlowDemoBoard/.test(readRepoFile("app-bootstrap.js")),
      "S0 is what replaced the credential-first opening",
    );
  });

  it("discovery-status-handoff.js runs the flow's own entry decision", () => {
    assert.ok(
      /maybeStart/.test(readRepoFile("discovery-status-handoff.js")),
      "the post-auth chain asks the controller, not the legacy gates",
    );
  });

  it("both legacy gates are GONE — L7 deleted the modules that defined them", () => {
    // L6 left them defined-but-unreachable on purpose so this suite could
    // prove boot no longer CALLS them. L7's sweep finished the job
    // (ONE-FLOW-ONBOARDING-SPEC §7), so the claim inverts.
    for (const file of ["first-run-wizard.js", "onboarding-wizard.js"]) {
      assert.throws(
        () => readRepoFile(file),
        /ENOENT/,
        `${file} must be deleted`,
      );
    }
  });
});

describe("L6 · the legacy surfaces stand down while the flow owns onboarding", () => {
  it("there is no legacy infra wizard left to claim the surface", () => {
    // The path that used to fire here was B1's own: signing in with no
    // sheet is exactly the state revealSetupScreenAfterAuth reacted to. L6
    // made the wizard stand down; L7 deleted it (§7), so the guarantee is
    // now structural — nothing on the page can open it.
    const env = loadCutover({ sheetId: "", signedIn: true });
    assert.equal(
      env.window.JobBoredApp.firstRunWizard,
      undefined,
      "the namespace itself is gone",
    );
    assert.equal(
      typeof env.host.checkInfraSetupGate,
      "undefined",
      "and the host bridge no longer carries its gate",
    );
  });

  it("post-sign-in reveal hands off to Beat 1, not to a deleted screen", async () => {
    // Signed in with no sheet is Beat 1's own state (spec §5 B1). The
    // starter-setup screen L6 fell back to is deleted (§7), so the reveal
    // opens the beat that creates or connects the sheet.
    const env = loadCutover({ sheetId: "", signedIn: true });
    env.setup.revealSetupScreenAfterAuth();
    await settle();
    assert.equal(env.openBeat(), "google");
    assert.notEqual(
      env.document.getElementById("sheetAccessGateScreen").style.display,
      "flex",
      "and no gate is left stranded in front of it",
    );
  });

  it("welcome.js's onboarding card does not mount over the demo board", async () => {
    // welcome.js boots on the jb-v2 flag (on by default) and mounts an
    // aria-modal onboarding card whenever onboardingComplete is false —
    // which is every cold start. Spec §7 deletes that half in L7; until
    // then it must not cover S0.
    const env = loadCutover({ sheetId: "" });
    env.document.body.classList.add("jb-v2");
    env.bootstrap.init();
    await settle();
    env.welcome.boot();
    await settle();

    assert.equal(
      env.welcomeRegion.querySelectorAll(".jbw-card").length,
      0,
      "the one-flow owns onboarding; welcome's card must stay dormant",
    );
    assert.equal(env.board.isActive(), true, "S0 is still the surface");
  });

  it("post-sign-in reveal does not re-open over a beat already on screen", async () => {
    // The "One more step." screen this used to paint is deleted (§7). What
    // has to hold now is idempotence: the reveal must not re-enter the flow
    // and restart the beat the user is already working in (spec §3.4).
    const env = loadCutover({ sheetId: "", signedIn: true });
    await env.flow.goToBeat("ai");
    await settle();
    assert.equal(env.openBeat(), "ai");

    env.setup.revealSetupScreenAfterAuth();
    await settle();

    assert.equal(
      env.openBeat(),
      "ai",
      "a live beat keeps the surface; the reveal stands down",
    );
  });
});
