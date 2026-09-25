import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  actionButton,
  loadArrival,
  renderedText,
  stepEvents,
} from "./oneflow-l1-harness.mjs";
import { readRepoFile } from "./oneflow-l0-harness.mjs";

/* ============================================================
   UX01 C7 — honest setup.

   Each probe pins one first-run audit row: the B1 detour stays open on
   a bad Client ID (FR-05), Google's "unverified app" screen is named
   rather than promised away (FR-12), a signed-out stranger connects
   THEIR sheet in one step (FR-13), the jargon has a plain lead (FR-14),
   a signed-in user with a sheet is told so (FR-20), and the copy uses
   one start command and honest SerpApi arithmetic (FR-15, FR-17).
   ============================================================ */

const SHEET_URL =
  "https://docs.google.com/spreadsheets/d/1mGJ04E3f2Tp0-7ErNlb8veXjnlKz3x5a6gwyzEFvnKQ/edit";

async function openGoogle(options = {}) {
  const env = loadArrival(options);
  await env.flow.open("google");
  return env;
}

describe("C7 · B1 copy is plain and true (FR-12, FR-14)", () => {
  it("leads the detour with what a Client ID is for", async () => {
    const env = await openGoogle();
    const text = renderedText(env.mount());
    assert.ok(text.includes("First time? You'll need a free Google app key"));
    assert.match(text, /proves this copy of JobBored is yours/);
    const input = env.mount().querySelector("#oneFlowOauthClientIdInput");
    assert.equal(input.getAttribute("aria-label"), "Your Google app key (Client ID)");
  });

  it("names Google's unverified-app screen instead of promising it away", async () => {
    const env = await openGoogle();
    const text = renderedText(env.mount());
    assert.ok(!text.includes("stops calling it an unverified app"));
    assert.match(text, /Google hasn't verified this app/);
    assert.match(text, /Advanced → Go to JobBored/);
  });

  it("keeps redirect_uri_mismatch behind 'Having trouble?'", async () => {
    const env = await openGoogle();
    const trouble = env.mount().querySelector(".oneflow-google__detour-trouble");
    assert.ok(trouble, "the error-code footnote is a disclosure");
    assert.equal(trouble.tagName, "DETAILS");
    assert.match(renderedText(trouble), /redirect_uri_mismatch/);
  });
});

describe("C7 · the B1 detour stays open on a bad Client ID (FR-05)", () => {
  it("re-renders the detour open after an invalid save", async () => {
    const env = await openGoogle();
    const details = env.mount().querySelector(".oneflow-google__detour");
    const save = env.mount().querySelector(".oneflow-google__client-id-save");
    env.mount().querySelector("#oneFlowOauthClientIdInput").value = "nope";
    save.dispatch("click", {});
    const after = env.mount().querySelector(".oneflow-google__detour");
    assert.equal(after.open, true, "the field and steps must stay in view");
    assert.ok(details, "the detour rendered before the save");
  });
});

describe("C7 · signed out + existing sheet connects THAT sheet (FR-13)", () => {
  it("labels the primary 'Sign in & connect this sheet' when signed out", async () => {
    const env = await openGoogle();
    await env.beats.google.handleAction("google_use_existing");
    const btn = actionButton(env.mount(), "google_connect_sheet");
    assert.equal(btn.textContent, "Sign in & connect this sheet");
  });

  it("signs in, verifies the pasted sheet, and never creates a starter sheet", async () => {
    const env = await openGoogle();
    await env.beats.google.handleAction("google_use_existing");
    env.mount().querySelector("#oneFlowSheetUrlInput").value = SHEET_URL;
    await env.beats.google.handleAction("google_connect_sheet");
    const names = env.host.__calls.map((c) => c.name);
    assert.ok(names.includes("signIn"), "the one button signs in");
    assert.ok(!names.includes("handleSetupCreateStarterSheet"));
    assert.equal(env.sheetAccessCalls.length, 1);
    assert.equal(
      env.sheetAccessCalls[0].sheetId,
      "1mGJ04E3f2Tp0-7ErNlb8veXjnlKz3x5a6gwyzEFvnKQ",
    );
    const done = stepEvents(env.events, "beat_completed").filter(
      (d) => d.beat === "google",
    );
    assert.equal(done.length, 1);
    assert.equal(done[0].createdSheet, false);
  });
});

describe("C7 · signed in with a sheet says so (FR-20)", () => {
  it("shows 'Signed in as … · Sheet connected ✓' instead of the create promise", async () => {
    const env = loadArrival();
    env.host.__state.signedIn = true;
    env.host.__state.userEmail = "user@example.com";
    env.host.__state.sheetId = "sheet-1";
    await env.flow.open("google");
    const text = renderedText(env.mount());
    assert.ok(text.includes("Signed in as user@example.com · Sheet connected ✓"));
  });
});

describe("C7 · one start command and honest arithmetic (FR-15, FR-17)", () => {
  it("names ONE start command in every beat — the one that runs discovery too", () => {
    // `npm start` omits the discovery worker B5 needs; `npm run dev` runs
    // the dashboard, scraper AND worker, so it is right in every beat.
    for (const file of ["oneflow-beat-ai.js", "oneflow-beat-discovery.js"]) {
      assert.ok(
        !/\bnpm start\b/.test(readRepoFile(file)),
        `${file} must not name a second start command`,
      );
    }
    assert.match(readRepoFile("oneflow-beat-ai.js"), /npm run dev/);
  });

  it("does not promise 100 searches is plenty for daily runs", () => {
    const src = readRepoFile("oneflow-beat-discovery.js");
    assert.ok(!/plenty for daily runs/.test(src));
    assert.match(src, /about 20 runs a month/);
  });
});

describe("C7 · the recommended provider pins a capable model (FR-07)", () => {
  it("B2's OpenRouter default is not a :free model the app calls weak", () => {
    const src = readRepoFile("oneflow-beat-ai.js");
    const block = src.slice(src.indexOf('id: "openrouter"'), src.indexOf('id: "gemini"'));
    const m = block.match(/defaultModel: "([^"]+)"/);
    assert.ok(m, "the OpenRouter card declares a default model");
    assert.ok(!m[1].endsWith(":free"), `default ${m[1]} is flagged weak for letters`);
    assert.match(readRepoFile("model-catalog.js"), new RegExp(`value: "${m[1]}"`));
  });
});
