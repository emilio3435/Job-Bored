import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { loadCutover, settle } from "./oneflow-l6-harness.mjs";

/* ============================================================
   B6 exit — where the two payoff actions actually land.

   Field report (Emilio, 2026-09-02): both `Run discovery now` and `Take
   me to my dashboard` dropped the user back on the SAMPLE board. Cause:
   while a beat owns the surface every reveal entry point defers to "the
   flow's own payoff exit" (sheet-access-setup.js revealDashboardShell),
   but finishFlow never revealed anything, and the S0 overlay only
   unmounts when real rows render — a sheet B1 just created has none.
   ============================================================ */

function loadAtPayoff(extraHost = {}) {
  return loadCutover({
    sheetId: "SHEET_1",
    signedIn: true,
    serverProfile: null,
    host: extraHost,
  });
}

async function openPayoffOverDemoBoard(env) {
  await env.board.mount();
  assert.equal(env.board.isActive(), true, "S0 is the surface under the flow");
  env.document.getElementById("dashboard").style.display = "none";
  await env.flow.goToBeat("payoff");
  await settle();
  assert.equal(env.openBeat(), "payoff");
}

describe("B6 exit — 'Take me to my dashboard' lands on the REAL dashboard", () => {
  it("unmounts the S0 demo board even though the new sheet has no rows yet", async () => {
    const env = loadAtPayoff();
    await openPayoffOverDemoBoard(env);

    await env.act("payoff_dashboard");
    await settle();

    assert.equal(env.flow.getState().completed, true, "the flow finished");
    assert.equal(
      env.board.isActive(),
      false,
      "a finished flow must not leave the fixture board on screen",
    );
    assert.equal(
      env.document.getElementById("oneFlowDemoBoard"),
      null,
      "the overlay is gone from the DOM, not merely flagged",
    );
  });

  it("reveals the dashboard shell the sign-in path deferred to the flow", async () => {
    const env = loadAtPayoff();
    await openPayoffOverDemoBoard(env);

    await env.act("payoff_dashboard");
    await settle();

    assert.equal(
      env.document.getElementById("dashboard").style.display,
      "block",
      "revealDashboardShell defers while a beat is open; the exit must call it",
    );
  });

  it("does not open the discovery drawer — the user asked for the board", async () => {
    const drawerOpens = [];
    const env = loadAtPayoff({
      openDiscoveryDrawer: (...args) => drawerOpens.push(args),
    });
    await openPayoffOverDemoBoard(env);

    await env.act("payoff_dashboard");
    await settle();

    assert.equal(drawerOpens.length, 0);
  });
});

describe("B6 exit — 'Run discovery now' lands in the run drawer over the real board", () => {
  it("fires the run, reveals the dashboard, and opens the discovery drawer", async () => {
    const drawerOpens = [];
    const env = loadAtPayoff({
      openDiscoveryDrawer: (...args) => drawerOpens.push(args),
    });
    await openPayoffOverDemoBoard(env);

    await env.act("payoff_run_now");
    await settle();

    assert.ok(
      env.called().includes("triggerDiscoveryRun"),
      "the run still fires (spec §5 B6)",
    );
    assert.equal(env.board.isActive(), false, "the sample board is gone");
    assert.equal(
      env.document.getElementById("dashboard").style.display,
      "block",
      "the run streams onto the REAL board",
    );
    assert.equal(
      drawerOpens.length,
      1,
      "the drawer is where the dashboard's own Run button shows a run — B6 lands there too",
    );
  });

  it("opens the drawer only after the flow relinquished the surface", async () => {
    const order = [];
    const env = loadAtPayoff({
      openDiscoveryDrawer: () => order.push(["drawer", env.flow.isOpen()]),
    });
    await openPayoffOverDemoBoard(env);

    await env.act("payoff_run_now");
    await settle();

    assert.deepEqual(
      order,
      [["drawer", false]],
      "a drawer opened under a still-open shell would be hidden behind it",
    );
  });
});
