import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadOneFlow } from "./oneflow-l0-harness.mjs";
import { loadCutover, settle } from "./oneflow-l6-harness.mjs";

/* ============================================================
   SIXBEATS-2 lane draft-persistence — NEW-14, NEW-7, NEW-6.

   The acceptance rerun on main @ cf0da4d refreshed the page mid-flow and
   lost everything the user had typed or drafted: Beat 4 came back empty
   and could not advance (NEW-14), Beat 3's resume text was gone (NEW-7),
   and after Escape there was no way back into a paused flow on a
   configured install (NEW-6).

   Spec §3.2 always said drafts persist "under the same key on input,
   debounced" and §3.4 said resuming lands on the saved beat "with drafts
   restored" — the controller simply never implemented it. These probes
   pin the seam SIXBEATS2-SPEC locked decision 4 defines
   (ctx.saveDraft / ctx.runtime.drafts) and decision 6's re-entry pill,
   so the drafting-provider lane can code against the same shape.
   ============================================================ */

const PROFILE_DRAFT = Object.freeze({
  version: 1,
  identity: {
    targetRoles: ["Staff Engineer"],
    targetSeniority: "ic_staff",
    primaryNarrative:
      "I build reliable distributed systems and lead high-leverage platform work.",
  },
  strengths: [{ name: "Distributed systems", rank: 1 }],
  hardConstraints: { workMode: "any", workAuth: "us_authorized" },
});

/** The pill lives in the body, not the harness's registered-id table. */
function pill(env) {
  return env.document.body.querySelector("#oneFlowResumePill");
}

function stubBeat(id, order, extra = {}) {
  return {
    id,
    order,
    timeLabel: `about ${20 - order} min left`,
    headline: `${id} headline`,
    sub: `${id} sub`,
    render(container) {
      container.appendChild(container.ownerDocument.createElement("p"));
    },
    ...extra,
  };
}

/**
 * A flow with one beat that hands its render context back, which is the
 * only way a beat ever sees saveDraft/runtime.drafts.
 */
async function flowWithCapturedCtx(beatId = "resume", order = 3) {
  const env = loadOneFlow();
  const seen = [];
  env.flow.registerBeat(
    stubBeat(beatId, order, {
      render(container, ctx) {
        seen.push(ctx);
        container.appendChild(container.ownerDocument.createElement("p"));
      },
    }),
  );
  await env.flow.open(beatId);
  return { ...env, ctx: () => seen[seen.length - 1], renders: seen };
}

describe("SB2 draft persistence — the controller seam (spec §3.2, locked decision 4)", () => {
  it("SB2-DRAFT-SAVE: ctx.saveDraft writes into flow state so a later read sees it", async () => {
    const env = await flowWithCapturedCtx();
    await env.ctx().saveDraft("resumeText", "Emilio — Staff Engineer\nAustin, TX");
    const stored = await env.store.getOnboardingFlowState();
    assert.equal(
      stored.drafts.resumeText,
      "Emilio — Staff Engineer\nAustin, TX",
      "NEW-7: resume text typed in B3 must outlive the page, not the tab",
    );
  });

  it("SB2-DRAFT-RUNTIME: a saved draft is readable on ctx.runtime.drafts immediately", async () => {
    const env = await flowWithCapturedCtx();
    await env.ctx().saveDraft("profileDraft", PROFILE_DRAFT);
    assert.deepEqual(
      env.ctx().runtime.drafts.profileDraft.identity.targetRoles,
      ["Staff Engineer"],
      "the beat that just saved must not have to wait for a round trip",
    );
  });

  it("SB2-DRAFT-DEBOUNCE: a burst of keystrokes collapses into one write", async () => {
    const env = await flowWithCapturedCtx();
    const ctx = env.ctx();
    let writes = 0;
    const save = env.store.saveOnboardingFlowState;
    env.store.saveOnboardingFlowState = (partial) => {
      if (partial && partial.drafts) writes += 1;
      return save(partial);
    };
    const typed = ["R", "Re", "Res", "Resu", "Resum", "Resume"];
    await Promise.all(typed.map((value) => ctx.saveDraft("resumeText", value)));
    assert.equal(
      writes,
      1,
      "spec §3.2 says debounced — one IndexedDB write per burst, not one per keystroke",
    );
    const stored = await env.store.getOnboardingFlowState();
    assert.equal(stored.drafts.resumeText, "Resume", "the last keystroke wins");
  });

  it("SB2-DRAFT-KEYS: an unknown draft key is rejected and never reaches the store", async () => {
    const env = await flowWithCapturedCtx();
    const ctx = env.ctx();
    assert.equal(await ctx.saveDraft("apiKey", "sk-live-do-not-persist"), false);
    const stored = await env.store.getOnboardingFlowState();
    assert.deepEqual(
      Object.keys(stored.drafts),
      [],
      "the drafts bag is two known keys, not a dumping ground for secrets",
    );
  });

  it("SB2-DRAFT-HYDRATE: open() hydrates ctx.runtime.drafts from what a previous session saved", async () => {
    const env = loadOneFlow();
    await env.store.saveOnboardingFlowState({
      beat: "fit",
      drafts: { profileDraft: PROFILE_DRAFT, resumeText: "typed earlier" },
    });
    const seen = [];
    env.flow.registerBeat(
      stubBeat("fit", 4, {
        render(container, ctx) {
          seen.push(ctx);
          container.appendChild(container.ownerDocument.createElement("p"));
        },
      }),
    );
    await env.flow.open();
    assert.equal(seen.length, 1, "the saved beat opened");
    assert.equal(seen[0].runtime.drafts.resumeText, "typed earlier");
    assert.deepEqual(
      seen[0].runtime.drafts.profileDraft.strengths,
      [{ name: "Distributed systems", rank: 1 }],
      "spec §3.4: resuming lands on the saved beat WITH drafts restored",
    );
  });

  it("SB2-DRAFT-GOTO: goToBeat() re-hydrates drafts for the beat it opens", async () => {
    const env = loadOneFlow();
    const seen = [];
    for (const [id, order] of [["resume", 3], ["fit", 4]]) {
      env.flow.registerBeat(
        stubBeat(id, order, {
          render(container, ctx) {
            seen.push({ id, ctx });
            container.appendChild(container.ownerDocument.createElement("p"));
          },
        }),
      );
    }
    await env.flow.open("resume");
    await seen[0].ctx.saveDraft("profileDraft", PROFILE_DRAFT);
    await env.flow.goToBeat("fit");
    const fit = seen.find((entry) => entry.id === "fit");
    assert.deepEqual(
      fit.ctx.runtime.drafts.profileDraft.identity.targetRoles,
      ["Staff Engineer"],
      "B3 drafts, B4 confirms — the handoff cannot depend on in-memory scratch",
    );
  });

  it("SB2-DRAFT-CLEAR: clearOnboardingFlowState wipes the drafts bag", async () => {
    const env = await flowWithCapturedCtx();
    await env.ctx().saveDraft("resumeText", "please forget this");
    await env.store.clearOnboardingFlowState();
    const stored = await env.store.getOnboardingFlowState();
    assert.deepEqual(
      Object.keys(stored.drafts),
      [],
      "a greenfield reset that leaves the last user's resume behind is a leak",
    );
  });

  it("SB2-DRAFT-NORMALIZE: the store keeps only known keys and coerces their types", async () => {
    const env = loadOneFlow();
    const saved = await env.store.saveOnboardingFlowState({
      drafts: {
        resumeText: 42,
        profileDraft: { identity: { targetRoles: ["Staff Engineer"] } },
        oauthToken: "ya29.leak",
      },
    });
    assert.deepEqual(Object.keys(saved.drafts).sort(), [
      "profileDraft",
      "resumeText",
    ]);
    assert.equal(saved.drafts.resumeText, "42", "a draft is text or an object, nothing else");
    assert.deepEqual(saved.drafts.profileDraft.identity.targetRoles, [
      "Staff Engineer",
    ]);
  });
});

describe("SB2 NEW-14 — Beat 4 survives a refresh (BLOCKER)", () => {
  it("SB2-FIT-DRAFT-READ: B4 renders from runtime.drafts.profileDraft when the in-memory draft is gone", () => {
    const env = loadOneFlow({ beatFiles: true });
    const beat = env.flow.getBeat("fit");
    const container = env.document.createElement("div");
    beat.render(container, {
      state: {},
      runtime: { drafts: { profileDraft: PROFILE_DRAFT } },
      setMessage() {},
      setBusy() {},
      clearBusy() {},
      saveDraft: async () => true,
      async completeBeat() {},
    });
    assert.match(
      container.textContent,
      /Staff Engineer/,
      "NEW-14: after a refresh the persisted draft is the ONLY draft there is",
    );
    assert.match(container.textContent, /Distributed systems/);
  });

  it("SB2-FIT-DRAFT-WRITE: editing a field in B4 persists the corrected draft (spec §3.2 'B4 edits')", () => {
    const env = loadOneFlow({ beatFiles: true });
    const beat = env.flow.getBeat("fit");
    const container = env.document.createElement("div");
    const saved = [];
    beat.render(container, {
      state: {},
      runtime: { drafts: { profileDraft: PROFILE_DRAFT } },
      setMessage() {},
      setBusy() {},
      clearBusy() {},
      saveDraft: async (key, value) => {
        saved.push({ key, value });
        return true;
      },
      async completeBeat() {},
    });
    const narrative = container.querySelector(".oneflow-fit-textarea");
    narrative.value = "I ship platforms other teams build careers on.";
    narrative.dispatch("input", {});
    const last = saved[saved.length - 1];
    assert.equal(last.key, "profileDraft");
    assert.equal(
      last.value.identity.primaryNarrative,
      "I ship platforms other teams build careers on.",
      "a correction the user made and then refreshed away is the same defect as NEW-14",
    );
  });

  it("SB2-FIT-RELOAD: the NEW-14 repro — draft, reload the page, B4 is populated and advances", async () => {
    const first = loadCutover({ sheetId: "sheet-1", signedIn: true });
    await settle();
    await first.flow.open("resume");
    await settle();
    await first.flow.saveDraft("profileDraft", PROFILE_DRAFT);
    await first.flow.goToBeat("fit");
    await settle();
    assert.equal(first.openBeat(), "fit");

    // Same IndexedDB, brand new page — a refresh.
    const second = loadCutover({
      sheetId: "sheet-1",
      signedIn: true,
      indexedDB: first.indexedDB,
    });
    await settle();
    await second.flow.open();
    await settle();
    assert.equal(second.openBeat(), "fit", "resume lands on the saved beat");
    assert.match(
      second.text(),
      /Staff Engineer/,
      "NEW-14: Beat 4 came back EMPTY on cf0da4d",
    );

    await second.act("confirm-fit");
    await settle();
    assert.equal(
      second.flow.getState().completedBeats.includes("fit"),
      true,
      "NEW-14: and it could not advance — 'Looks like me →' did nothing",
    );
  });
});

describe("SB2 NEW-6 — a paused flow can always be resumed", () => {
  it("SB2-PILL-SHOWN: Escape off the demo board leaves a 'Resume setup ▸' pill", async () => {
    const env = loadCutover({ sheetId: "sheet-1", signedIn: true });
    await settle();
    await env.flow.open("fit");
    await settle();
    env.flow.close("escape");
    const resumePill = pill(env);
    assert.ok(
      resumePill,
      "NEW-6: a configured install had NO way back into a paused flow",
    );
    assert.equal(resumePill.textContent, "Resume setup ▸");
    assert.match(
      resumePill.getAttribute("aria-label") || "",
      /Your fit/,
      "the label has to say which beat it returns to",
    );
  });

  it("SB2-PILL-REOPENS: clicking the pill reopens the saved beat and takes the pill away", async () => {
    const env = loadCutover({ sheetId: "sheet-1", signedIn: true });
    await settle();
    await env.flow.open("fit");
    await settle();
    env.flow.close("escape");
    pill(env).dispatch("click", {});
    await settle();
    assert.equal(env.openBeat(), "fit");
    assert.equal(
      pill(env),
      null,
      "the pill must never sit over the shell it just opened",
    );
  });

  it("SB2-PILL-NOT-ON-BOARD: the demo board's own pill is the re-entry there — no second one", async () => {
    const env = loadCutover({ sheetId: "", signedIn: false });
    await settle();
    await env.board.mount();
    await env.flow.open("fit");
    await settle();
    env.flow.close("escape");
    assert.equal(
      pill(env),
      null,
      "spec §4's invitation card already re-enters the flow on S0",
    );
  });

  it("SB2-PILL-GONE-WHEN-DONE: a completed flow leaves no pill behind", async () => {
    const env = loadCutover({ sheetId: "sheet-1", signedIn: true });
    await settle();
    await env.flow.open("fit");
    await settle();
    env.flow.close("escape");
    assert.ok(pill(env));
    await env.flow.open("payoff");
    await settle();
    await env.flow.completeBeat("payoff");
    await settle();
    assert.equal(
      pill(env),
      null,
      "'Resume setup' over a finished setup is a lie",
    );
  });
});
