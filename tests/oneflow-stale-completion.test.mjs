import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { loadCutover, settle } from "./oneflow-l6-harness.mjs";

/* ============================================================
   A "completed" flow with no sheet is a stale answer, not a finished user.

   Field report (Emilio, 2026-09-02): the stored config carried a masked
   sheetId ("") while onboardingFlowState.completed was still true — the
   greenfield reset masks localStorage but its IndexedDB drop is
   best-effort and stays blocked while another tab holds the store open.
   Boot then trusted `completed`, never re-ran Beat 1, and every getter
   behind getConfig() (webhook URL, webhook secret) read as empty: the
   first run 401'd with "needs a webhook secret" although the secret sat
   in localStorage the whole time.

   Spec §3.3 says a finished user never sees the flow again — but B1's
   exit condition is `getSheetId()` truthy, so "finished" without a sheet
   cannot be honoured. The flow restarts instead of stranding the user.
   ============================================================ */

const ALL_BEATS = ["google", "ai", "resume", "fit", "discovery", "payoff"];

async function boot(env) {
  await env.status.runPostAccessBootstrapOnce();
  await settle();
}

describe("stale completion — no sheet means the deal is back on", () => {
  it("restarts at B1 when the flow says completed but no sheet is configured", async () => {
    const env = loadCutover({ sheetId: "", signedIn: true });
    await env.store.saveOnboardingFlowState({
      completed: true,
      beat: "payoff",
      completedBeats: ALL_BEATS,
    });

    await boot(env);

    assert.equal(env.openBeat(), "google", "the sheet is the substrate (§3.3)");
    assert.equal(
      env.flow.getState().completed,
      false,
      "the stale answer is cleared, not merely ignored for one boot",
    );
    assert.equal(
      env.flow.getState().completedBeats.length,
      0,
      "beats earned against the old sheet do not carry over",
    );
  });

  it("does not let legacy completion flags mark the flow complete without a sheet", async () => {
    const env = loadCutover({ sheetId: "", signedIn: true });
    await env.store.completeInfraSetup();
    await env.store.completeOnboarding();

    await boot(env);

    assert.equal(env.openBeat(), "google");
    assert.equal(env.flow.getState().completed, false);
  });

  it("still never re-onboards a finished user who has a sheet", async () => {
    const env = loadCutover({ sheetId: "SHEET_1", signedIn: true });
    await env.store.saveOnboardingFlowState({
      completed: true,
      beat: "payoff",
      completedBeats: ALL_BEATS,
    });

    await boot(env);

    assert.equal(env.openBeat(), "", "spec §3.3: never re-onboard an existing user");
    assert.equal(env.flow.getState().completed, true);
  });
});
