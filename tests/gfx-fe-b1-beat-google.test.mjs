import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { actionButton, loadArrival, renderedText } from "./oneflow-l1-harness.mjs";
import { readRepoFile } from "./oneflow-l0-harness.mjs";

/* ============================================================
   GFX FE-B1 — Beat 1 (Google + Sheet) ledger rows G1–G16, B1-N1…N6.

   Each probe names the ledger row whose false error, dead end or
   unexplained step it closes (SPEC §4 Beat 1).
   ============================================================ */

const SHEET_URL =
  "https://docs.google.com/spreadsheets/d/1mGJ04E3f2Tp0-7ErNlb8veXjnlKz3x5a6gwyzEFvnKQ/edit";

async function openGoogle(options = {}) {
  const env = loadArrival(options);
  await env.flow.open("google");
  return env;
}

function message(env) {
  const node = env.mount().querySelector(".discovery-setup-wizard__message");
  return node ? node.textContent : "";
}

function hrefOf(node) {
  return node.href || node.getAttribute("href");
}

describe("G1–G7 · the detour and its copy", () => {
  it("G1: the detour is open by default when there is no Client ID", async () => {
    const env = await openGoogle({ host: { getOAuthClientId: () => "" } });
    assert.equal(env.mount().querySelector(".oneflow-google__detour").open, true);
  });

  it("G1: it stays collapsed when a Client ID is saved", async () => {
    const env = await openGoogle();
    assert.notEqual(env.mount().querySelector(".oneflow-google__detour").open, true);
  });

  it("G2: names the cost honestly, without 'genuinely tedious'", async () => {
    const text = renderedText((await openGoogle()).mount());
    assert.ok(
      text.includes("Google calls it a Client ID. It takes about 10 minutes, and you only do it once."),
    );
    assert.equal(/tedious/i.test(text), false);
  });

  it("G3: every step links to its Cloud Console page", async () => {
    const env = await openGoogle();
    const steps = env.beats.google.DETOUR_STEPS;
    for (const step of steps) {
      assert.equal(typeof step.text, "string");
      assert.match(step.href, /^https:\/\/console\.cloud\.google\.com\//);
    }
    const hrefs = steps.map((s) => s.href);
    for (const path of [
      "/projectcreate",
      "/apis/credentials/consent",
      "/apis/library/sheets.googleapis.com",
      "/apis/credentials/oauthclient",
    ]) {
      assert.ok(hrefs.some((h) => h.endsWith(path)), path);
    }
    const links = env.mount().querySelectorAll(".oneflow-google__detour-step-link");
    assert.equal(links.length, steps.length, "one rendered link per step");
    assert.deepEqual([...links.map(hrefOf)], [...hrefs]);
  });

  it("G4: the scope step names …/auth/spreadsheets", async () => {
    assert.match(renderedText((await openGoogle()).mount()), /Data access.*\/auth\/spreadsheets/);
  });

  it("G5: the app is named JobBored, so 'Go to JobBored (unsafe)' matches", async () => {
    const text = renderedText((await openGoogle()).mount());
    assert.match(text, /name the app JobBored/);
    assert.match(text, /Advanced → Go to JobBored \(unsafe\)/);
  });

  it("G6: says Client ID, never 'app key' or 'OAuth client' on its own", () => {
    const src = readRepoFile("oneflow-beat-google.js");
    assert.equal(/app key/i.test(src), false);
    assert.equal(/Google OAuth client\b/i.test(src), false);
  });

  it("G7: the sub says there is no server that sees your data", async () => {
    const text = renderedText((await openGoogle()).mount());
    assert.ok(text.includes("JobBored has no server that sees your data."));
    assert.equal(text.includes("our side"), false);
  });

  it("G11: explains localhost vs 127.0.0.1", async () => {
    assert.match(
      renderedText((await openGoogle()).mount()),
      /localhost and 127\.0\.0\.1 as different addresses/,
    );
  });

  it("G12: 'Having trouble?' covers Error 403 access_denied", async () => {
    const env = await openGoogle();
    const trouble = env.mount().querySelector(".oneflow-google__detour-trouble");
    assert.match(renderedText(trouble), /access_denied.*test user/);
  });
});

describe("B1-N1 · G15 · G22 · honest permission copy", () => {
  it("names the three permissions, what Sheets access covers, and the sheet's name", async () => {
    const text = renderedText((await openGoogle()).mount());
    assert.equal(text.includes("We ask for one permission"), false);
    assert.ok(
      text.includes(
        "Google will ask to let JobBored see and edit your Google Sheets, and read your name and email.",
      ),
    );
    assert.ok(text.includes("JobBored only opens the sheet it creates or the one you paste."));
    assert.match(text, /a sheet named “JobBored Pipeline \d{4}-\d{2}-\d{2}” in your Drive, owned by you/);
  });

  it("G22: says where the sign-in and the Client ID live", async () => {
    const text = renderedText((await openGoogle()).mount());
    assert.ok(
      text.includes(
        "JobBored keeps your Google access token in this tab only; new tabs sign you in again quietly. Your Client ID and Sheet link are saved in this browser.",
      ),
    );
  });
});

describe("B1-N2 · scope_missing re-asks with consent inside the next click", () => {
  it("shows the tick-the-box message when the creator answers scope_missing", async () => {
    const env = await openGoogle({
      host: {
        handleSetupCreateStarterSheet: async () => ({ ok: false, reason: "scope_missing" }),
      },
    });
    await env.beats.google.handleAction("google_continue");
    assert.equal(message(env), env.beats.google.SCOPE_MISSING_MESSAGE);
    assert.match(message(env), /tick 'See, edit, create… Google Sheets'/);
    assert.equal(env.flow.getState().completedBeats.includes("google"), false);
  });

  it("catches a missing Sheets grant before the create, so the creator never re-asks outside a gesture", async () => {
    let granted = false;
    const env = await openGoogle({
      host: {
        hasGrantedOauthScope: (scope) =>
          scope === "https://www.googleapis.com/auth/spreadsheets" && granted,
      },
    });
    await env.beats.google.handleAction("google_continue");
    const creates = env.host.__calls.filter((c) => c.name === "handleSetupCreateStarterSheet");
    assert.equal(creates.length, 0, "no create without the Sheets grant");
    assert.equal(message(env), env.beats.google.SCOPE_MISSING_MESSAGE);

    // The next click: signIn({prompt:"consent"}) BEFORE the handler yields.
    const before = env.host.__calls.length;
    const pending = env.beats.google.handleAction("google_continue");
    const sync = env.host.__calls.slice(before).filter((c) => c.name === "signIn");
    assert.equal(sync.length, 1, "consent is requested synchronously, inside the gesture");
    granted = true;
    assert.equal(JSON.stringify(sync[0].args[0]), JSON.stringify({ prompt: "consent" }));
    await pending;
    assert.ok(env.flow.getState().completedBeats.includes("google"));
  });
});

describe("G16 · Open your sheet ↗, never window.open", () => {
  it("renders the created sheet's URL as a link when B1 is revisited, and carries it for B6", async () => {
    const env = await openGoogle();
    await env.beats.google.handleAction("google_continue");
    await env.flow.open("google");
    const link = env.mount().querySelector(".oneflow-google__sheet-link");
    assert.ok(link, "a signed-in, connected B1 links the sheet");
    assert.equal(link.textContent, "Open your sheet ↗");
    assert.equal(hrefOf(link), "https://docs.google.com/spreadsheets/d/created-sheet-id/edit");
  });

  it("has no window.open anywhere in the beat", () => {
    assert.equal(/window\.open\s*\(/.test(readRepoFile("oneflow-beat-google.js")), false);
  });
});

describe("B1-N3 · a blocked Google sign-in script is named", () => {
  for (const [label, host] of [
    ["isGoogleSignInReady() false", { isGoogleSignInReady: () => false }],
    ["no token client (fallback)", { getTokenClient: () => null }],
  ]) {
    it(`${label}: names the blocker instead of waiting two minutes`, async () => {
      const env = await openGoogle({ host });
      await env.beats.google.handleAction("google_continue");
      assert.equal(env.host.__calls.some((c) => c.name === "signIn"), false);
      assert.equal(
        message(env),
        "Google's sign-in script hasn't loaded. If you use an ad or tracker blocker, allow accounts.google.com, then reload.",
      );
    });
  }
});

describe("B1-N4 · connect-existing names the reason", () => {
  for (const reason of ["access_denied", "headers_unreadable", "no_token"]) {
    it(`${reason} gets its own sentence`, async () => {
      const env = await openGoogle({
        verifyExistingSheetAccess: async () => ({ ok: false, reason }),
      });
      await env.beats.google.handleAction("google_use_existing");
      env.host.__state.signedIn = true;
      env.mount().querySelector("#oneFlowSheetUrlInput").value = SHEET_URL;
      await env.beats.google.handleAction("google_connect_sheet");
      assert.equal(message(env), env.beats.google.EXISTING_SHEET_ERRORS[reason]);
    });
  }

  it("the three reasons read differently", async () => {
    const env = await openGoogle();
    const copies = Object.values(env.beats.google.EXISTING_SHEET_ERRORS);
    assert.equal(new Set(copies).size, 3);
  });
});

describe("B1-N6 · the header comment names the live collaborators", () => {
  it("no longer points at the deleted first-run wizard", () => {
    const head = readRepoFile("oneflow-beat-google.js").split("(function ()")[0];
    assert.equal(head.includes("first-run-wizard.js"), false);
    assert.match(head, /sheet-access-setup\.js[\s\S]*verifyExistingSheetAccess/);
  });
});

describe("D1 · one primary action per B1 state", () => {
  it("sign-in and existing-sheet modes each carry one primary", async () => {
    const env = await openGoogle();
    const primaries = () =>
      env.mount().querySelectorAll(".discovery-setup-wizard__btn--primary").length;
    assert.equal(primaries(), 1);
    await env.beats.google.handleAction("google_use_existing");
    assert.equal(primaries(), 1);
    assert.ok(actionButton(env.mount(), "google_connect_sheet"));
  });
});
