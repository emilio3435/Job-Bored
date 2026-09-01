import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { loadCutover, readRepoFile, settle } from "./oneflow-l6-harness.mjs";

/* ============================================================
   ONEFLOW L7 — the three decisions L6 routed here.

   8.  One draft key. B3 wrote `runtime.resumeDraft`, B4 read it through
       an alias chain L6 added to keep the resume-first premise alive
       (spec §2, §5 B3→B4). Two names for one handoff is the shape that
       breaks the next time someone adds a third reader, so the canon is
       `profileDraft` and the alias is deleted.

   9.  The shell title must show the RESOLVED payoff headline. Spec §5 B6
       is "You're live, {firstName}." — a template, and `registerBeat`
       froze it as a literal string, so the shell painted the braces at
       the user while only the celebration overlay resolved them.

   10. A mid-flow token expiry must not paint the login gate over a live
       beat (spec §3.4: the flow owns the surface until it closes). The
       ownership guard showSheetAccessGate already applied to the legacy
       wizard now covers the one-flow too.
   ============================================================ */

const RESUME_PROFILE = Object.freeze({
  identity: {
    targetRoles: ["Staff Platform Engineer"],
    primaryNarrative: "I build the systems other teams ship on top of.",
  },
  strengths: [{ name: "Distributed systems", rank: 1 }],
  hardConstraints: {
    workMode: "hybrid_ok",
    acceptableLocations: ["Denver"],
    salaryFloor: 190000,
  },
});

/** loadCutover, with /profile/from-resume answering like the real route. */
function loadWithResumeDraft(options = {}) {
  return loadCutover({
    sheetId: "SHEET_1",
    signedIn: true,
    serverProfile: null,
    ...options,
    async fetchImpl(call) {
      if (/\/profile\/from-resume$/.test(call.url)) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ ok: true, profile: RESUME_PROFILE }),
        };
      }
      return null;
    },
  });
}

/** Drive B3's paste path the way the beat's own action does. */
async function ingestResume(env) {
  await env.flow.goToBeat("resume");
  await settle();
  const paste = env.document
    .getElementById("oneFlowMount")
    .querySelector("#oneFlowResumePaste");
  assert.ok(paste, "B3 renders a paste field");
  paste.value =
    "Staff Platform Engineer at Acme. Built the deploy platform. Denver, CO.";
  await env.act("resume_use_text");
  await settle();
}

describe("routed 8 · one draft key — `profileDraft` is the canon (spec §5 B3→B4)", () => {
  it("B3 leaves the drafted profile under runtime.profileDraft", async () => {
    const env = loadWithResumeDraft();
    await ingestResume(env);

    // seedRuntime({}) returns the very object the controller hands beats.
    const runtime = env.flow.seedRuntime({});
    assert.ok(
      runtime.profileDraft,
      "B3 must write the canonical key, not a second name for it",
    );
    assert.deepEqual(
      runtime.profileDraft.profile.identity.targetRoles,
      ["Staff Platform Engineer"],
      "and it carries the profile the server drafted",
    );
    assert.equal(
      runtime.resumeDraft,
      undefined,
      "the second name is gone, not merely unread",
    );
  });

  it("B4 still arrives drafted — the handoff survives the rename", async () => {
    const env = loadWithResumeDraft();
    await ingestResume(env);

    await env.flow.goToBeat("fit");
    await settle();

    assert.equal(env.openBeat(), "fit");
    assert.match(
      env.text(),
      /Staff Platform Engineer/,
      "B4 shows what B3 drafted; an empty B4 is the resume-first premise dying",
    );
    assert.match(env.text(), /Denver/);
  });

  it("neither beat file mentions the retired alias", () => {
    for (const file of ["oneflow-beat-resume.js", "oneflow-beat-fit.js"]) {
      assert.equal(
        /resumeDraft/.test(readRepoFile(file)),
        false,
        `${file} must carry one draft key, not two`,
      );
    }
  });
});

describe("routed 9 · the shell title shows the resolved headline (spec §5 B6)", () => {
  it("renders the user's name, never the raw {firstName} token", async () => {
    const env = loadWithResumeDraft({ givenName: "Priya" });
    await env.flow.goToBeat("payoff");
    await settle();

    const text = env.text();
    assert.equal(
      /\{firstName\}/.test(text),
      false,
      "a template token on screen is the defect this fixes",
    );
    assert.match(
      text,
      /You're live, Priya\./,
      "the shell title carries the resolved payoff headline",
    );
  });

  it("drops the comma when Google gave no name — never 'You're live, .'", async () => {
    const env = loadWithResumeDraft({ givenName: null });
    await env.flow.goToBeat("payoff");
    await settle();

    const text = env.text();
    assert.equal(/\{firstName\}/.test(text), false);
    assert.equal(
      /You're live, \./.test(text),
      false,
      "the fallback drops the comma (spec §5 B6)",
    );
    assert.match(text, /You're live\./);
  });

  it("a plain-string headline still renders — the resolver is additive", async () => {
    const env = loadWithResumeDraft();
    await env.flow.goToBeat("google");
    await settle();

    assert.equal(env.openBeat(), "google");
    assert.ok(env.text().length > 0, "B1's literal headline is untouched");
  });
});

describe("routed 10 · the login gate stands down for a live beat (spec §3.4)", () => {
  it("a mid-flow showSheetAccessGate does not paint over the beat", async () => {
    const env = loadWithResumeDraft();
    await env.flow.open("google");
    await settle();
    assert.equal(env.openBeat(), "google");

    env.setup.showSheetAccessGate("signin");
    await settle();

    const gate = env.document.getElementById("sheetAccessGateScreen");
    assert.notEqual(
      gate.style.display,
      "flex",
      "an expiring token must not strand a gate over the flow",
    );
    assert.equal(env.openBeat(), "google", "the beat still owns the surface");
    assert.equal(
      gate.dataset.gateMode,
      "signin",
      "the requested mode is remembered so the gate resumes correctly",
    );
  });

  it("the gate paints normally again once the flow closes", async () => {
    const env = loadWithResumeDraft();
    await env.flow.open("google");
    await settle();
    env.flow.close("test");
    await settle();

    env.setup.showSheetAccessGate("signin");
    await settle();

    assert.equal(
      env.document.getElementById("sheetAccessGateScreen").style.display,
      "flex",
      "closing the flow restores the normal gate behavior",
    );
  });
});
