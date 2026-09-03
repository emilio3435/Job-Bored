import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { loadCutover, settle } from "./oneflow-l6-harness.mjs";

/* ============================================================
   Entering the flow re-checks the sheet, not just booting it.

   Field report (Emilio, 2026-09-02), reproduced in his own browser: with a
   masked sheetId he clicked the S0 invitation card and landed on Beat 6 —
   "You're live." with all six segments checked and nothing configured. The
   only controls there are Close, "Run discovery now" (which 400s, no sheet)
   and "Take me to my dashboard" (an empty board). The spine is not
   interactive, so there is no route back to Beat 1: closing returns to S0,
   whose button reopens Beat 6. A loop.

   Cause: the staleness check added in 1c7f016 lives in maybeStart(), which
   only runs inside the post-sign-in bootstrap. A user with no sheet is signed
   out, so that chain never fires — while the S0 card calls open() directly,
   and open() resumes state.beat. The check belongs at the shared seam.

   Drafts are NOT collateral: a masked sheet says nothing about the resume the
   user pasted, and re-typing it is the punishment this whole flow exists to
   avoid.
   ============================================================ */

const ALL_BEATS = ["google", "ai", "resume", "fit", "discovery", "payoff"];
const DRAFTS = { resumeText: "Staff Platform Engineer at Acme.", profileDraft: { version: 1 } };

async function seedFinishedFlow(env) {
  await env.store.saveOnboardingFlowState({
    completed: true,
    beat: "payoff",
    completedBeats: ALL_BEATS,
    drafts: DRAFTS,
  });
}

describe("open() re-checks the sheet — the S0 card cannot land on the payoff", () => {
  it("opens Beat 1, not the saved payoff, when no sheet is configured", async () => {
    const env = loadCutover({ sheetId: "", signedIn: false });
    await seedFinishedFlow(env);

    // Exactly what the S0 invitation card does: open() with no argument.
    await env.flow.open();
    await settle();

    assert.equal(
      env.openBeat(),
      "google",
      "a flow with no sheet must start at the beat that connects one",
    );
    assert.equal(env.flow.getState().completed, false, "the stale answer is cleared");
    assert.equal(env.flow.getState().completedBeats.length, 0);
  });

  it("keeps the user's drafts — a masked sheet is not a reason to retype a resume", async () => {
    const env = loadCutover({ sheetId: "", signedIn: false });
    await seedFinishedFlow(env);

    await env.flow.open();
    await settle();

    const drafts = env.flow.getState().drafts || {};
    assert.equal(
      drafts.resumeText,
      DRAFTS.resumeText,
      "the resume survives the restart",
    );
    assert.ok(drafts.profileDraft, "so does the drafted profile");
  });

  it("still resumes the saved beat when a sheet IS configured", async () => {
    const env = loadCutover({ sheetId: "SHEET_1", signedIn: true });
    await env.store.saveOnboardingFlowState({
      completed: false,
      beat: "fit",
      completedBeats: ["google", "ai", "resume"],
      drafts: DRAFTS,
    });

    await env.flow.open();
    await settle();

    assert.equal(env.openBeat(), "fit", "spec §3.4: reopening lands on the saved beat");
    assert.equal(env.flow.getState().completedBeats.length, 3);
  });

  it("an explicit target still wins — goToBeat-style entry is untouched", async () => {
    const env = loadCutover({ sheetId: "SHEET_1", signedIn: true });
    await seedFinishedFlow(env);

    await env.flow.open("discovery");
    await settle();

    assert.equal(env.openBeat(), "discovery");
  });

  it("clears the completion only once — a second open does not re-reset", async () => {
    const env = loadCutover({ sheetId: "", signedIn: false });
    await seedFinishedFlow(env);

    await env.flow.open();
    await settle();
    const startedAt = env.flow.getState().startedAt;

    await env.flow.close("test");
    await settle();
    await env.flow.open();
    await settle();

    assert.equal(env.openBeat(), "google");
    assert.equal(
      env.flow.getState().startedAt,
      startedAt,
      "the restart stamp is not rewritten on every re-entry",
    );
  });
});
