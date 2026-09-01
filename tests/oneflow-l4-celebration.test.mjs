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
   best-tested piece of the old onboarding (persistent CTA handoff,
   reveal-under-the-fade, the inert click-through fix). Deleting its host
   in L7 must not delete the player with it, so the player moved to its
   own module first; L7 then deleted the host, the four legacy stage
   configs, and the delegating alias.

   These probes pin the survivor: the new home behaves exactly as the old
   one did, and the finale is the only stage left.
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

  it("persists: no auto-dismiss timer, and the CTA takes focus (a11y)", () => {
    const env = loadCelebrationModule();
    let done = 0;
    env.celebration.playOnboardingCelebration(() => {
      done += 1;
    });
    assert.equal(env.overlay.hidden, false, "the overlay shows");
    assert.equal(
      env.timers.length,
      0,
      "no timed dismissal — the celebration waits for the user",
    );
    assert.equal(done, 0, "onDone must not fire until the CTA is clicked");
    assert.equal(
      env.els.onboardingCelebrationContinue.__focused,
      true,
      "the continue CTA receives focus",
    );
  });

  it("the handoff fires at fade START so the next chapter mounts underneath", () => {
    const env = loadCelebrationModule();
    let done = 0;
    env.celebration.playOnboardingCelebration(() => {
      done += 1;
    });
    env.els.onboardingCelebrationContinue.dispatch("click", {});
    assert.equal(done, 1, "onDone runs immediately on click");
    assert.equal(
      env.overlay.classList.contains("onboarding-celebration--out"),
      true,
    );
    env.drainTimers();
    assert.equal(done, 1, "the cleanup timer must not fire it twice");
    assert.equal(env.overlay.hidden, true, "hidden after the fade");
  });

  it("inerts every body sibling while up, and restores them on dismiss", () => {
    // Live repro: overflow:auto containers win hit-testing over a higher-z
    // sibling in Chromium, so the CTA read as dead. Keeping the mechanic is
    // the whole reason the player is moved rather than rewritten.
    const env = loadCelebrationModule();
    env.celebration.playOnboardingCelebration(() => {});
    assert.equal(
      env.other.hasAttribute("inert"),
      true,
      "background siblings are inerted while the overlay is up",
    );
    assert.equal(
      env.overlay.hasAttribute("inert"),
      false,
      "the overlay itself is un-inerted so its CTA is clickable",
    );
    env.els.onboardingCelebrationContinue.dispatch("click", {});
    env.drainTimers();
    assert.equal(
      env.other.hasAttribute("inert"),
      false,
      "interactivity is restored so the next chapter is usable",
    );
  });

  it("spawns confetti into the burst host and clears it on dismiss", () => {
    const env = loadCelebrationModule();
    const burst = env.els.onboardingCelebrationConfetti;
    env.celebration.playOnboardingCelebration(() => {});
    assert.ok(burst.children.length > 0, "confetti pieces are spawned");
    env.els.onboardingCelebrationContinue.dispatch("click", {});
    env.drainTimers();
    assert.equal(burst.children.length, 0, "and cleared after the fade");
  });

  it("falls back to a timed dismissal when the CTA is missing (stale markup)", () => {
    const env = loadCelebrationModule({ withCta: false });
    let done = 0;
    env.celebration.playOnboardingCelebration(() => {
      done += 1;
    });
    assert.ok(env.timers.length >= 1, "a fallback timer is scheduled");
    env.drainTimers();
    assert.equal(done, 1, "the handoff never strands");
  });

  it("hands off to onAlt instead of onDone when the alt link is used", () => {
    const env = loadCelebrationModule();
    let done = 0;
    let alt = 0;
    env.celebration.playOnboardingCelebration(
      () => { done += 1; },
      "profile",
      { onAlt: () => { alt += 1; } },
    );
    assert.equal(env.els.onboardingCelebrationAlt.hidden, false);
    env.els.onboardingCelebrationAlt.dispatch("click", {});
    assert.equal(alt, 1);
    assert.equal(done, 0, "the primary handoff must not also fire");
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

  it("the flow finale marks every legacy journey step done — nothing is 'next'", () => {
    // B6 IS the end of the deal. A journey strip still pointing at a
    // remaining step would contradict the receipt the beat just handed over.
    const env = loadCelebrationModule();
    env.celebration.playOnboardingCelebration(() => {}, "flow_payoff");
    assert.equal(
      env.celebration.STAGES.flow_payoff.currentIndex,
      4,
      "past the last legacy step, so all four render done and none current",
    );
  });

  it("the flow finale takes its headline and sub from the caller (per-user copy)", () => {
    // "You're live, {firstName}." is resolved by B6 from the Google session;
    // the player renders what it is handed rather than owning the name.
    const env = loadCelebrationModule();
    env.celebration.playOnboardingCelebration(() => {}, "flow_payoff", {
      title: "You're live, Priya.",
      sub: "That was the one-time part. From here, JobBored works for you.",
      cta: "See what happens now →",
    });
    assert.equal(
      env.els.onboardingCelebrationTitle.textContent,
      "You're live, Priya.",
    );
    assert.equal(
      env.els.onboardingCelebrationSub.textContent,
      "That was the one-time part. From here, JobBored works for you.",
    );
    assert.equal(
      env.els.onboardingCelebrationContinue.textContent,
      "See what happens now →",
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
