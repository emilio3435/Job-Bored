import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  loadCutover,
  plain,
  settle,
  stepEvents,
} from "../oneflow-l6-harness.mjs";

/* ============================================================
   Integration: the ONE flow, boot to payoff.

   This file used to pin the mandatory TWO-TRACK chain — discovery and
   go-live auto-opening each other until both completion flags landed.
   ONE-FLOW-ONBOARDING-SPEC §3 replaced that chain with a single flow, so
   the convergence claim moved with it: one shell, six beats, and one set
   of completion flags that every legacy reader still sees.

   Everything below drives the REAL page in one vm context — the store,
   the shell, the controller, all six beats, the demo board, the boot
   files, and the what's-next banner — exactly the wiring index.html
   ships. A beat is advanced by firing its own footer action, never by
   calling the controller past it, so a broken handoff between two beats
   fails here rather than in production. (It already has: B3 wrote its
   draft under a key B4 did not read; see LANE-REPORT-L6 §5.)
   ============================================================ */

/** A drafted profile the server returns for B3's resume. */
const DRAFTED_PROFILE = {
  identity: {
    targetRoles: ["Staff Engineer", "Platform Engineer"],
    targetSeniority: "ic_staff",
    primaryNarrative:
      "I build the platform systems other teams ship their work on top of.",
  },
  strengths: [
    { name: "Distributed systems", rank: 1 },
    { name: "Technical leadership", rank: 2 },
  ],
  wants: ["hands-on building"],
  avoids: ["on-call rotations without staffing"],
  hardConstraints: {
    workMode: "hybrid_ok",
    acceptableLocations: ["Austin"],
    salaryFloor: 185000,
  },
};

function newFlowEnv(overrides = {}) {
  const env = loadCutover({
    sheetId: "",
    signedIn: false,
    givenName: "Priya",
    withBanner: true,
    wizardUi: { runTailscaleAutoSetup: async () => ({ ok: true }) },
    fetchImpl: async (call) => {
      if (call.url.includes("/profile/from-resume")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ ok: true, profile: DRAFTED_PROFILE }),
        };
      }
      return null;
    },
    ...overrides,
  });
  // B2 holds its "✓ Connected" line for 1.4 s before advancing so the
  // promised reward can be read (SIXBEATS2 NEW-4). The shell's onAction is
  // fire-and-forget, so these walks settle on macrotasks rather than on the
  // beat's promise — waiting out the real hold six times over would buy
  // nothing these probes are about. tests/sixbeats2-finale.test.mjs owns
  // the hold itself.
  env.window.JobBoredOneFlowBeatAi._internal.timings.successHoldMs = 0;
  return env;
}

/** Type into a rendered beat field the way a user does. */
function type(env, id, value) {
  const input = env.mount().querySelector(`[id="${id}"]`);
  assert.ok(input, `expected a rendered field #${id}`);
  input.value = value;
  input.dispatch("input", { target: input });
  return input;
}

/** B1 → B5 fuel. Leaves the flow on B5 with the connect panel unlocked. */
async function walkToConnectPanel(env) {
  await env.act("google_continue");
  await settle(10);
  type(env, "oneFlowAiKeyInput", "sk-or-v1-test");
  await env.act("ai_check");
  await settle(10);
  type(env, "oneFlowResumePaste", "Staff engineer. Ten years of platform work.");
  await env.act("resume_use_text");
  await settle(10);
  await env.act("confirm-fit");
  await settle(10);
  type(env, "oneFlowSerpApiKeyInput", "serpapi-test-key");
  await env.act("oneflow_discovery_save_verify");
  await settle(10);
}

describe("integration: cold start opens on the product (spec §4)", () => {
  it("mounts the demo board with the shipped fixture and no credential ask", async () => {
    const env = newFlowEnv();
    env.bootstrap.init();
    await settle();

    assert.equal(env.board.isActive(), true);
    const board = env.document.body.querySelector(".oneflow-demo");
    assert.ok(board, "S0 must be in the document");
    assert.ok(
      board.querySelectorAll(".oneflow-demo__card").length > 0,
      "a zero-config visitor sees scored demo cards, not an empty shell",
    );
    assert.match(board.textContent, /This is your job hunt on autopilot\./);
    assert.equal(
      env.called().includes("showSheetAccessGate"),
      false,
      "and never a Google client-id ask first",
    );
  });

  it("the invitation card opens Beat 1 (spec §3.4 entry)", async () => {
    const env = newFlowEnv();
    env.bootstrap.init();
    await settle();

    const primary = env.document.body
      .querySelector(".oneflow-demo")
      .querySelector(".oneflow-demo__invite-action--primary");
    assert.ok(primary, '"Make it mine" must be on the board');
    primary.dispatch("click", {});
    await settle();

    assert.equal(env.openBeat(), "google");
  });
});

describe("integration: sign-in walks B1 → B6 (spec §5)", () => {
  it("each beat's own action advances to the next, in spec order", async () => {
    const env = newFlowEnv();
    env.bootstrap.init();
    await settle();
    await env.status.runPostAccessBootstrapOnce();
    await settle();

    const seen = [env.openBeat()];
    await env.act("google_continue");
    await settle(10);
    seen.push(env.openBeat());

    type(env, "oneFlowAiKeyInput", "sk-or-v1-test");
    await env.act("ai_check");
    await settle(10);
    seen.push(env.openBeat());

    type(env, "oneFlowResumePaste", "Staff engineer. Ten years of platform work.");
    await env.act("resume_use_text");
    await settle(10);
    seen.push(env.openBeat());

    await env.act("confirm-fit");
    await settle(10);
    seen.push(env.openBeat());

    type(env, "oneFlowSerpApiKeyInput", "serpapi-test-key");
    await env.act("oneflow_discovery_save_verify");
    await settle(10);
    await env.act("oneflow_discovery_connect");
    await settle(10);
    seen.push(env.openBeat());

    assert.deepEqual(seen, [
      "google",
      "ai",
      "resume",
      "fit",
      "discovery",
      "payoff",
    ]);
  });

  it("B4 confirms what B3 drafted — no datum is asked twice (spec §2.3)", async () => {
    const env = newFlowEnv();
    await env.flow.open("google");
    await settle();
    await env.act("google_continue");
    await settle(10);
    type(env, "oneFlowAiKeyInput", "sk-or-v1-test");
    await env.act("ai_check");
    await settle(10);
    type(env, "oneFlowResumePaste", "Staff engineer. Ten years of platform work.");
    await env.act("resume_use_text");
    await settle(10);

    assert.equal(env.openBeat(), "fit");
    const rendered = env.text();
    assert.match(rendered, /Staff Engineer/);
    assert.match(rendered, /Distributed systems/);
    assert.match(rendered, /Austin/);
  });

  it("finishing B6 writes every legacy completion flag (spec §3.2)", async () => {
    const env = newFlowEnv();
    await env.flow.open("google");
    await settle();
    await walkToConnectPanel(env);
    await env.act("oneflow_discovery_connect");
    await settle(10);
    assert.equal(env.openBeat(), "payoff");

    await env.act("payoff_dashboard");
    await settle(10);

    assert.equal(await env.store.isOnboardingComplete(), true);
    assert.equal(await env.store.isInfraSetupComplete(), true);
    assert.equal(
      await env.store.isDiscoverySetupComplete(),
      true,
      "connect succeeded, so the discovery track is complete too",
    );
    assert.equal(env.flow.getState().completed, true);
    assert.equal(env.openBeat(), "", "the shell closes on the payoff exit");
    assert.equal(
      stepEvents(env.events, "flow_completed").length,
      1,
      "exactly one flow_completed (spec §9)",
    );
  });

  it("the completed flow is the ONE celebration (spec §5 B6, §7)", async () => {
    const env = newFlowEnv();
    const celebrations = [];
    env.window.JobBoredOnboardingCelebration = {
      STAGES: { flow_payoff: {} },
      playOnboardingCelebration(done, stage, options) {
        celebrations.push({ stage, title: (options && options.title) || "" });
        if (typeof done === "function") done();
      },
    };
    await env.flow.open("google");
    await settle();
    await walkToConnectPanel(env);
    await env.act("oneflow_discovery_connect");
    await settle(10);

    assert.deepEqual(celebrations, [
      { stage: "flow_payoff", title: "You're live, Priya." },
    ]);
  });
});

describe("integration: escape is pausing, not skipping (spec §3.4)", () => {
  it("closing returns to the demo board and re-entry lands on the saved beat", async () => {
    const env = newFlowEnv();
    env.bootstrap.init();
    await settle();
    await env.flow.open("google");
    await settle();
    await env.act("google_continue");
    await settle(10);
    type(env, "oneFlowAiKeyInput", "sk-or-v1-test");
    await env.act("ai_check");
    await settle(10);
    assert.equal(env.openBeat(), "resume");

    env.shell.closeWizardShell("escape");
    await settle();

    assert.equal(env.flow.isOpen(), false, "the shell is closed");
    assert.equal(
      env.board.isActive(),
      true,
      "and the (demo) board is what is behind it",
    );
    const abandoned = stepEvents(env.events, "beat_abandoned");
    assert.equal(abandoned.length, 1);
    assert.equal(abandoned[0].beat, "resume");
    assert.equal(abandoned[0].reason, "escape");

    await env.flow.open();
    await settle();
    assert.equal(
      env.openBeat(),
      "resume",
      "closing is pausing — re-entry resumes the saved beat",
    );
  });

  it("a required beat stays required after a close", async () => {
    const env = newFlowEnv();
    await env.flow.open("google");
    await settle();
    env.shell.closeWizardShell("close-button");
    await settle();

    assert.deepEqual(
      plain(env.flow.getState().completedBeats),
      [],
      "an abandoned beat is never recorded as done",
    );
  });
});

describe("integration: a refresh mid-flow resumes the beat (spec §3.4)", () => {
  it("reloading the page lands on the persisted beat with the flow still open", async () => {
    const first = newFlowEnv();
    await first.flow.open("google");
    await settle();
    await first.act("google_continue");
    await settle(10);
    type(first, "oneFlowAiKeyInput", "sk-or-v1-test");
    await first.act("ai_check");
    await settle(10);
    assert.equal(first.openBeat(), "resume");

    // A reload: a brand-new page against the same stored state.
    const reloaded = newFlowEnv({
      indexedDB: first.indexedDB,
      sheetId: "created-sheet-id",
      signedIn: true,
    });
    await reloaded.status.runPostAccessBootstrapOnce();
    await settle();

    assert.equal(reloaded.openBeat(), "resume");
    assert.deepEqual(plain(reloaded.flow.getState().completedBeats), [
      "google",
      "ai",
    ]);
  });
});

describe("integration: the skipped-connect end state (spec §5 B5/B6)", () => {
  it("skipping connect finishes the flow and leaves the banner carrying the nudge", async () => {
    const env = newFlowEnv();
    await env.flow.open("google");
    await settle();
    await walkToConnectPanel(env);

    await env.act("oneflow_discovery_skip_connect");
    await settle(10);
    assert.equal(env.openBeat(), "payoff");
    assert.match(
      env.text(),
      /Connection is off/,
      "B6 must render the skipped variant, not the armed one",
    );

    await env.act("payoff_dashboard");
    await settle(10);

    assert.equal(await env.store.isOnboardingComplete(), true);
    assert.equal(await env.store.isInfraSetupComplete(), true);
    assert.equal(
      await env.store.isDiscoverySetupComplete(),
      false,
      "a skipped connection is not a completed discovery setup",
    );

    const state = await env.banner.refreshBanner();
    assert.equal(state.discoveryComplete, false);
    assert.equal(
      env.whatsNextRegion.hasAttribute("hidden"),
      false,
      "the banner — not a gate — carries the remaining nudge (spec §3.3)",
    );
  });

  it("the fuel key is NOT skippable — a keyless setup is the ledger §5 B5 forbids", async () => {
    const env = newFlowEnv();
    await env.flow.open("discovery");
    await settle();

    await env.act("oneflow_discovery_skip_connect");
    await settle();

    assert.equal(env.openBeat(), "discovery", "the beat must not advance");
    assert.match(env.text(), /isn't skippable/);
  });
});

describe("integration: a finished flow never re-onboards (spec §3.3)", () => {
  it("the next boot goes straight to the dashboard", async () => {
    const first = newFlowEnv();
    await first.flow.open("google");
    await settle();
    await walkToConnectPanel(first);
    await first.act("oneflow_discovery_connect");
    await settle(10);
    await first.act("payoff_dashboard");
    await settle(10);

    const next = newFlowEnv({
      indexedDB: first.indexedDB,
      sheetId: "created-sheet-id",
      signedIn: true,
      withBanner: true,
    });
    await next.status.runPostAccessBootstrapOnce();
    await settle();

    assert.equal(next.openBeat(), "", "no beat renders for a finished profile");
    const state = await next.banner.refreshBanner();
    assert.equal(
      state.discoveryComplete,
      true,
      "the banner reads the flags the flow wrote, not its own bookkeeping",
    );
    assert.equal(
      state.goLiveComplete,
      false,
      "other-devices stays a deferred §6 moment the banner nudges, never a gate",
    );
  });
});
