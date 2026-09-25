import assert from "node:assert/strict";
import { describe, it } from "node:test";
import vm from "node:vm";

import {
  loadCelebrationModule,
  readRepoFile,
} from "./oneflow-l4-harness.mjs";

/* ============================================================
   The celebration extraction (ONE-FLOW-ONBOARDING-SPEC §5 B6, §7).

   WHY: the teardown counted FOUR confetti bursts before the first job.
   The spec collapses them to one, at B6 — but the player itself is the
   best-tested piece of the old onboarding, so it MOVED to its own module
   before L7 deleted its host. These probes pin the survivor.

   What the survivor is changed with SIXBEATS2 (locked decision 2). The
   acceptance rerun found the moved player mounting a full-screen
   `aria-modal` card over Beat 6, with its own CTA and journey strip, and
   never dismissing itself — the payoff's actions were unclickable for
   the whole sample (NEW-1, BLOCKER). The persistent-CTA handoff and the
   inert click-through fix were mechanics that existed to make THAT card
   usable; a burst that eats no clicks needs neither, so they went with
   it. What survives here is the contract every caller still depends on:
   the player renders what it is handed, cleans up after itself, and
   never strands its handoff.

   The finale's own claims (non-modal, no strip/CTA/alt, auto-fade,
   pointer-events, reduced motion) live in tests/sixbeats2-finale.test.mjs.
   ============================================================ */

describe("onboarding-celebration.js — the extracted player (spec §7)", () => {
  it("publishes the player on its own global", () => {
    const env = loadCelebrationModule();
    assert.equal(
      typeof env.celebration.playOnboardingCelebration,
      "function",
      "window.JobBoredOnboardingCelebration owns the player now",
    );
  });

  it("dismisses itself on a timer rather than waiting on a CTA", () => {
    // SIXBEATS2 decision 2: the burst is decoration over a live beat, so
    // there is nothing for the user to click and nothing to wait for.
    const env = loadCelebrationModule();
    let done = 0;
    env.celebration.playOnboardingCelebration(() => {
      done += 1;
    });
    assert.equal(env.overlay.hidden, false, "the overlay shows");
    assert.equal(done, 0, "onDone waits for the burst to finish");
    assert.equal(env.timers.length, 1, "one self-dismissal is scheduled");
    assert.equal(env.timers[0].ms, env.celebration.TIMINGS.burstMs);
  });

  it("the handoff fires at fade START so anything chained mounts underneath", () => {
    const env = loadCelebrationModule();
    let done = 0;
    env.celebration.playOnboardingCelebration(() => {
      done += 1;
    });
    env.timers.shift().fn(); // the burst elapses
    assert.equal(done, 1, "onDone runs as the fade begins");
    assert.equal(
      env.overlay.classList.contains("onboarding-celebration--out"),
      true,
    );
    env.drainTimers();
    assert.equal(done, 1, "the cleanup timer must not fire it twice");
    assert.equal(env.overlay.hidden, true, "hidden after the fade");
  });

  it("leaves every body sibling interactive while it is up", () => {
    // The old player inerted the whole page so ITS cta could win hit
    // testing over an overflow:auto wizard. The burst is the opposite
    // contract: Beat 6 stays usable underneath it (SIXBEATS2 decision 2).
    const env = loadCelebrationModule();
    env.celebration.playOnboardingCelebration(() => {});
    assert.equal(env.other.hasAttribute("inert"), false);
    assert.equal(env.overlay.hasAttribute("inert"), false);
    env.drainTimers();
    assert.equal(env.other.hasAttribute("inert"), false);
  });

  it("spawns confetti into the burst host and clears it on dismiss", () => {
    const env = loadCelebrationModule();
    const burst = env.els.onboardingCelebrationConfetti;
    env.celebration.playOnboardingCelebration(() => {});
    assert.ok(burst.children.length > 0, "confetti pieces are spawned");
    env.drainTimers();
    assert.equal(burst.children.length, 0, "and cleared after the fade");
  });

  it("calls onDone immediately when the overlay is absent", () => {
    // The whole DOM can be missing in a stripped build; the chain must
    // still advance rather than strand.
    const win = {};
    const ctx = {
      window: win,
      document: { getElementById: () => null, createElement: () => ({}) },
      console,
      setTimeout,
      clearTimeout,
    };
    vm.createContext(ctx);
    vm.runInContext(readRepoFile("onboarding-celebration.js"), ctx, {
      filename: "onboarding-celebration.js",
    });
    let done = 0;
    win.JobBoredOnboardingCelebration.playOnboardingCelebration(() => {
      done += 1;
    });
    assert.equal(done, 1);
  });
});

describe("celebration stages — one flow finale, nothing else (spec §5 B6, §7)", () => {
  it("the four legacy stages are deleted, not merely unused", () => {
    // profile / discovery / devices / bonus were four "done" moments before
    // a single job existed. L7's sweep removed them with their callers.
    const env = loadCelebrationModule();
    assert.deepEqual(Object.keys(env.celebration.STAGES), ["flow_payoff"]);
  });

  it("an unknown or absent stage key still plays the finale, never nothing", () => {
    // A caller passing a retired key must degrade to the one celebration
    // that exists, not to a blank overlay.
    for (const arg of [undefined, "devices", "bonus"]) {
      const env = loadCelebrationModule();
      env.celebration.playOnboardingCelebration(() => {}, arg);
      assert.equal(
        env.els.onboardingCelebrationTitle.textContent,
        "You're live.",
      );
    }
  });

  it("the flow finale takes its headline and sub from the caller (per-user copy)", () => {
    // "You're live, {firstName}." is resolved by B6 from the Google session;
    // the player renders what it is handed rather than owning the name.
    const env = loadCelebrationModule();
    env.celebration.playOnboardingCelebration(() => {}, "flow_payoff", {
      title: "You're live, Priya.",
      sub: "That was the one-time part. From here, JobBored works for you.",
    });
    assert.equal(
      env.els.onboardingCelebrationTitle.textContent,
      "You're live, Priya.",
    );
    assert.equal(
      env.els.onboardingCelebrationSub.textContent,
      "That was the one-time part. From here, JobBored works for you.",
    );
  });

  it("the flow finale has an honest default when no copy is supplied", () => {
    const env = loadCelebrationModule();
    env.celebration.playOnboardingCelebration(() => {}, "flow_payoff");
    assert.equal(
      env.els.onboardingCelebrationTitle.textContent,
      "You're live.",
      "spec §5 B6's graceful fallback when the first name is unknown",
    );
  });
});

// The delegating alias in onboarding-wizard.js is gone with that module
// (ONE-FLOW-ONBOARDING-SPEC §7). Its job was to keep first-run, discovery
// and go-live calling the extracted player through the old namespace; all
// three of those call sites were deleted too, so B6 talks to
// window.JobBoredOnboardingCelebration directly and there is nothing left
// to delegate. tests/oneflow-l7-sweep.test.mjs holds the one-call-site
// claim (§10 Phase 1 acceptance).
