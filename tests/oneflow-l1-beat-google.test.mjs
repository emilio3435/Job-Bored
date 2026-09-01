import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  actionButton,
  loadArrival,
  renderedText,
  stepEvents,
} from "./oneflow-l1-harness.mjs";

/* ============================================================
   ONE-FLOW spec §5 B1 — Connect Google.

   B1 is the beat that replaced the login gate AND the "One more step."
   starter-setup screen (both deleted in L7's sweep): signing
   in and owning a Sheet stop being two chapters. These probes pin the
   four things that make it that:

     · the primary path signs in through the EXISTING auth entry and
       creates the sheet through the EXISTING creator — a beat that
       forked either would drift from the surface Settings still uses;
     · the beat cannot complete without a sheet (spec §5 B1 exit
       condition: getSheetId() truthy);
     · the secondary path connects an existing sheet through the
       existing validation, and a failed check reaches the SCREEN
       (§3.5.2) instead of the console;
     · the first-timer detour ships the honest copy — consent screen in,
       Drive API out, no gcloud button (§5 B1, §10 Phase 0).
   ============================================================ */

const BEAT_ID = "google";

async function openBeat(options = {}) {
  const env = loadArrival(options);
  await env.flow.open(BEAT_ID);
  return env;
}

describe("B1 Connect Google — the primary path (spec §5 B1)", () => {
  it("renders the normative headline and sub verbatim", async () => {
    const env = await openBeat();
    const text = renderedText(env.mount());
    assert.ok(
      text.includes("Your pipeline lives in a Google Sheet you own."),
      "spec §5 B1 headline is normative",
    );
    assert.ok(
      text.includes(
        "Sign in and we'll create it for you. Nothing is stored on our side " +
          "— there is no 'our side.'",
      ),
      "spec §5 B1 sub is normative",
    );
  });

  it("offers Continue with Google and the existing-sheet escape as shell actions", async () => {
    const env = await openBeat();
    const primary = actionButton(env.mount(), "google_continue");
    assert.ok(primary, "the primary action must be a shell action so setBusy can disable it");
    assert.equal(primary.textContent, "Continue with Google");
    const secondary = actionButton(env.mount(), "google_use_existing");
    assert.ok(secondary);
    assert.equal(secondary.textContent, "Connect an existing sheet instead");
  });

  it("signs in through the existing auth entry, then creates the sheet through the existing creator", async () => {
    const env = await openBeat();
    await env.beats.google.handleAction("google_continue");
    const names = env.host.__calls.map((c) => c.name);
    assert.ok(
      names.includes("signIn"),
      "B1 must call auth-session's signIn — never re-implement the OAuth dance",
    );
    assert.ok(
      names.includes("handleSetupCreateStarterSheet"),
      "B1 must call sheet-access-setup's creator — never re-implement the POST",
    );
    const create = env.host.__calls.find(
      (c) => c.name === "handleSetupCreateStarterSheet",
    );
    assert.equal(
      create.args[0].context,
      "wizard",
      "wizard context keeps the create inside the flow instead of handing off to the dashboard",
    );
  });

  it("renders the three normative stages and completes with createdSheet:true", async () => {
    const env = await openBeat({ host: { __email: "" } });
    env.host.__state.userEmail = "stranger@example.com";
    await env.beats.google.handleAction("google_continue");
    const stages = env.beats.google.getRenderedStages();
    assert.deepEqual(
      [...stages.map((s) => s.label)],
      [
        "Signed in as stranger@example.com ✓",
        "Creating your Pipeline sheet…",
        "Sheet ready ✓",
      ],
      "spec §5 B1: the stage list is normative and interpolates the real email",
    );
    const completed = stepEvents(env.events, "beat_completed").filter(
      (d) => d.beat === BEAT_ID,
    );
    assert.equal(completed.length, 1);
    assert.equal(completed[0].createdSheet, true);
  });

  it("auto-advances to B2 once the sheet exists", async () => {
    const env = await openBeat();
    await env.beats.google.handleAction("google_continue");
    assert.equal(env.flow.getState().beat, "ai", "spec §3.1: B1 → B2, no interstitial");
    assert.ok(env.flow.getState().completedBeats.includes(BEAT_ID));
  });

  it("does not create a second sheet when one is already connected", async () => {
    const env = await openBeat({ host: { __noop: true } });
    env.host.__state.sheetId = "already-connected";
    env.host.__state.signedIn = true;
    env.host.__state.userEmail = "returning@example.com";
    await env.beats.google.handleAction("google_continue");
    const creates = env.host.__calls.filter(
      (c) => c.name === "handleSetupCreateStarterSheet",
    );
    assert.equal(creates.length, 0, "an existing sheet is the exit condition, not a reason to make another");
    const completed = stepEvents(env.events, "beat_completed").filter(
      (d) => d.beat === BEAT_ID,
    );
    assert.equal(completed[0].createdSheet, false);
  });

  it("does not complete when the creator leaves the flow without a sheet", async () => {
    const env = await openBeat({
      host: {
        handleSetupCreateStarterSheet: async (opts) => {
          if (typeof opts.onStatus === "function") {
            opts.onStatus("Could not create the starter sheet.", true);
          }
        },
      },
    });
    await env.beats.google.handleAction("google_continue");
    assert.equal(
      env.flow.getState().completedBeats.includes(BEAT_ID),
      false,
      "spec §5 B1 exit condition is getSheetId() truthy — nothing else",
    );
    const message = env.mount().querySelector(".discovery-setup-wizard__message");
    assert.ok(message, "the failure must reach the message slot (§3.5.2), not just the console");
    assert.ok(
      message.classList.contains("discovery-setup-wizard__message--error"),
    );
  });
});

describe("B1 Connect Google — connect an existing sheet (spec §5 B1 secondary)", () => {
  it("swaps in an inline sheet-URL field", async () => {
    const env = await openBeat();
    await env.beats.google.handleAction("google_use_existing");
    const input = env.mount().querySelector("#oneFlowSheetUrlInput");
    assert.ok(input, "the escape is an INLINE field, not another screen");
    assert.ok(actionButton(env.mount(), "google_connect_sheet"));
  });

  it("reuses the existing sheet-access validation and completes with createdSheet:false", async () => {
    const env = await openBeat();
    await env.beats.google.handleAction("google_use_existing");
    env.host.__state.signedIn = true;
    env.mount().querySelector("#oneFlowSheetUrlInput").value =
      "https://docs.google.com/spreadsheets/d/1mGJ04E3f2Tp0-7ErNlb8veXjnlKz3x5a6gwyzEFvnKQ/edit#gid=0";
    await env.beats.google.handleAction("google_connect_sheet");
    assert.equal(
      env.sheetAccessCalls.length,
      1,
      "B1 must reuse verifyExistingSheetAccess — a beat-local check would drift",
    );
    assert.equal(
      env.sheetAccessCalls[0].sheetId,
      "1mGJ04E3f2Tp0-7ErNlb8veXjnlKz3x5a6gwyzEFvnKQ",
    );
    const patch = env.host.__calls.find(
      (c) => c.name === "mergeStoredConfigOverridePatch",
    );
    assert.equal(patch.args[0].sheetId, "1mGJ04E3f2Tp0-7ErNlb8veXjnlKz3x5a6gwyzEFvnKQ");
    const completed = stepEvents(env.events, "beat_completed").filter(
      (d) => d.beat === BEAT_ID,
    );
    assert.equal(completed[0].createdSheet, false);
  });

  it("renders a parse failure in the message slot and stays on the beat", async () => {
    const env = await openBeat();
    await env.beats.google.handleAction("google_use_existing");
    env.mount().querySelector("#oneFlowSheetUrlInput").value = "not a sheet";
    await env.beats.google.handleAction("google_connect_sheet");
    assert.equal(env.sheetAccessCalls.length, 0);
    assert.equal(env.flow.getState().completedBeats.includes(BEAT_ID), false);
    const message = env.mount().querySelector(".discovery-setup-wizard__message");
    assert.ok(message.textContent.includes("Google Sheet"));
    assert.ok(message.classList.contains("discovery-setup-wizard__message--error"));
  });

  it("renders an access failure in the message slot and stays on the beat", async () => {
    const env = await openBeat({
      verifyExistingSheetAccess: async () => ({ ok: false, reason: "access_denied" }),
    });
    await env.beats.google.handleAction("google_use_existing");
    env.host.__state.signedIn = true;
    env.mount().querySelector("#oneFlowSheetUrlInput").value =
      "https://docs.google.com/spreadsheets/d/1mGJ04E3f2Tp0-7ErNlb8veXjnlKz3x5a6gwyzEFvnKQ/edit";
    await env.beats.google.handleAction("google_connect_sheet");
    assert.equal(env.flow.getState().completedBeats.includes(BEAT_ID), false);
    const message = env.mount().querySelector(".discovery-setup-wizard__message");
    assert.ok(
      message.classList.contains("discovery-setup-wizard__message--error"),
      "voice rule §8.4: the error reaches the screen and names the next action",
    );
  });
});

describe("B1 Connect Google — the first-timer detour (spec §5 B1, §10 Phase 0)", () => {
  it("ships the collapsed details with the honest ten-minute estimate", async () => {
    const env = await openBeat();
    const details = env.mount().querySelector(".oneflow-google__detour");
    assert.ok(details, "the Cloud Console walkthrough is a collapsed details, never a screen");
    assert.equal(details.tagName, "DETAILS");
    const text = renderedText(env.mount());
    assert.ok(text.includes("First time? You'll need a free Client ID"));
    assert.ok(
      /about 10 minutes/i.test(text),
      "voice rule §8.2: a 10-minute detour says 10 minutes",
    );
    assert.ok(text.includes("You only ever do this once."));
  });

  it("keeps the consent-screen step", async () => {
    const env = await openBeat();
    assert.match(
      renderedText(env.mount()),
      /OAuth consent screen/,
      "the consent screen is the step first-timers actually miss — Phase 0 keeps it",
    );
  });

  it("renders no Drive API step — JobBored never touches Drive", async () => {
    const env = await openBeat();
    assert.equal(
      /Drive API/i.test(renderedText(env.mount())),
      false,
      "spec §5 B1 / §10 Phase 0: the Drive API step is removed",
    );
  });

  it("renders no gcloud button until oauth-bootstrap mints a real Web client", async () => {
    const env = await openBeat();
    const text = renderedText(env.mount());
    assert.equal(/gcloud/i.test(text), false, "spec §5 B1: until then the button is ABSENT");
    assert.equal(env.mount().querySelectorAll("[data-action-id]").length > 0, true);
    assert.equal(
      env
        .mount()
        .querySelectorAll("[data-action-id]")
        .some((el) => /gcloud/i.test(el.dataset.actionId || "")),
      false,
    );
  });
});
