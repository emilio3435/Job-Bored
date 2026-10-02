import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadArrival } from "./oneflow-l1-harness.mjs";

/* ============================================================
   HOLES AUTH — Beat 1 (Google) ends its waits honestly.

   A6 closing Google's window ends the sign-in wait at once, with its
      own message, and Continue can try again.

   Against the real beat in the L1 arrival sandbox.
   ============================================================ */

function message(env) {
  const node = env.mount().querySelector(".discovery-setup-wizard__message");
  return node ? node.textContent : "";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Does `pending` settle within `ms`? (A stuck wait must fail, not hang the file.) */
async function settlesWithin(pending, ms) {
  const outcome = await Promise.race([pending.then(() => "settled"), sleep(ms).then(() => "waiting")]);
  return outcome === "settled";
}

describe("A6 · closing Google's window ends Beat 1's wait at once", () => {
  function popupClosingHost(counter) {
    return {
      signIn() {
        counter.signIns += 1;
        return Promise.resolve({ ok: false, reason: "popup_closed" });
      },
    };
  }

  it("shows its own message and lets Continue try again", async () => {
    const counter = { signIns: 0 };
    const env = loadArrival({ host: popupClosingHost(counter) });
    await env.flow.open("google");

    const wait = env.beats.google.handleAction("google_continue");
    assert.equal(await settlesWithin(wait, 300), true, "no two-minute wait");
    assert.equal(
      message(env),
      "You closed the Google window before signing in. Press Continue with Google to try again.",
    );

    void env.beats.google.handleAction("google_continue");
    assert.equal(counter.signIns, 2, "the retry is not swallowed");
  });

  it("does the same on the connect-an-existing-sheet path", async () => {
    const counter = { signIns: 0 };
    const env = loadArrival({ host: popupClosingHost(counter) });
    await env.flow.open("google");
    await env.beats.google.handleAction("google_use_existing");
    env.mount().querySelector("#oneFlowSheetUrlInput").value =
      "https://docs.google.com/spreadsheets/d/1mGJ04E3f2Tp0-7ErNlb8veXjnlKz3x5a6gwyzEFvnKQ/edit";

    const wait = env.beats.google.handleAction("google_connect_sheet");
    assert.equal(await settlesWithin(wait, 300), true);
    assert.equal(
      message(env),
      "You closed the Google window before signing in. Press Sign in & connect this sheet to try again.",
    );
  });
});
