import assert from "node:assert/strict";
import { describe, it } from "node:test";
import vm from "node:vm";

import {
  loadCelebrationModule,
  makeCelebrationDom,
  readRepoFile,
} from "./oneflow-l4-harness.mjs";

/* ============================================================
   The celebration extraction (ONE-FLOW-ONBOARDING-SPEC §5 B6, §7).

   WHY: the teardown counted FOUR confetti bursts before the first job.
   The spec collapses them to one, at B6 — but the player itself is the
   best-tested piece of the old onboarding (persistent CTA handoff,
   reveal-under-the-fade, the inert click-through fix). Deleting its host
   in L7 must not delete the player with it, so the player moves to its
   own module NOW and onboarding-wizard.js keeps a thin delegating alias
   until the legacy chain is gone.

   These probes pin BOTH halves: the new home behaves exactly as the old
   one did, and the alias still carries every legacy caller.
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

describe("celebration stages — four legacy, one flow finale (spec §5 B6, §7)", () => {
  const cases = [
    ["profile", "Workspace connected!", "Build your profile →"],
    ["discovery", "Profile set!", "Set up job discovery →"],
    ["devices", "Discovery is live!", "Set up other devices →"],
    ["bonus", "You're fully set up!", "Maximize your results →"],
  ];
  for (const [stage, title, cta] of cases) {
    it(`legacy stage "${stage}" keeps its copy verbatim (L7 deletes these, not L4)`, () => {
      const env = loadCelebrationModule();
      env.celebration.playOnboardingCelebration(() => {}, stage);
      assert.equal(env.els.onboardingCelebrationTitle.textContent, title);
      assert.equal(env.els.onboardingCelebrationContinue.textContent, cta);
    });
  }

  it("no stage argument still means the profile-finish beat (backward compatible)", () => {
    const env = loadCelebrationModule();
    env.celebration.playOnboardingCelebration(() => {});
    assert.equal(env.els.onboardingCelebrationTitle.textContent, "Profile set!");
  });

  it("adds exactly ONE new stage — the flow finale B6 fires", () => {
    const env = loadCelebrationModule();
    const stages = Object.keys(env.celebration.STAGES);
    assert.deepEqual(
      stages.sort(),
      ["bonus", "devices", "discovery", "flow_payoff", "profile"].sort(),
      "four legacy stages plus the single flow finale, nothing else",
    );
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

describe("onboarding-wizard.js — the delegating alias (until L7)", () => {
  function loadWizardWithPlayer({ withPlayer = true } = {}) {
    const { doc } = makeCelebrationDom();
    const win = { JobBoredApp: { core: { host: {} } } };
    const ctx = {
      window: win,
      document: doc,
      console: { warn() {}, error() {}, log() {} },
      setTimeout: () => 0,
      clearTimeout: () => {},
    };
    vm.createContext(ctx);
    if (withPlayer) {
      vm.runInContext(readRepoFile("onboarding-celebration.js"), ctx, {
        filename: "onboarding-celebration.js",
      });
    }
    vm.runInContext(readRepoFile("onboarding-wizard.js"), ctx, {
      filename: "onboarding-wizard.js",
    });
    return { window: win, document: doc, onboarding: win.JobBoredApp.onboarding };
  }

  it("still exposes playOnboardingCelebration so every legacy caller works", () => {
    const env = loadWizardWithPlayer();
    assert.equal(typeof env.onboarding.playOnboardingCelebration, "function");
  });

  it("forwards onDone, the stage key, and opts to the extracted player", () => {
    const env = loadWizardWithPlayer();
    const seen = [];
    env.window.JobBoredOnboardingCelebration.playOnboardingCelebration = (
      ...args
    ) => seen.push(args);
    const cb = () => {};
    const opts = { onAlt: () => {} };
    env.onboarding.playOnboardingCelebration(cb, "devices", opts);
    assert.equal(seen.length, 1);
    assert.equal(seen[0][0], cb);
    assert.equal(seen[0][1], "devices");
    assert.equal(seen[0][2], opts);
  });

  it("still completes the handoff when the player module never loaded", () => {
    // Load-order regressions killed welcome.js once already; a missing
    // player must degrade to "no confetti", never to "stuck wizard".
    const env = loadWizardWithPlayer({ withPlayer: false });
    let done = 0;
    env.onboarding.playOnboardingCelebration(() => {
      done += 1;
    });
    assert.equal(done, 1);
  });

  it("no longer carries the player's implementation", () => {
    const src = readRepoFile("onboarding-wizard.js");
    assert.ok(
      !/function spawnCelebrationConfetti/.test(src),
      "the confetti driver moved out",
    );
    assert.ok(
      !/const STAGE_CELEBRATIONS =/.test(src),
      "the stage table moved out",
    );
    assert.ok(
      !/function applyCelebrationStage/.test(src),
      "the overlay driver moved out",
    );
  });

  it("every caller resolves the player LAZILY, so script order can't kill it", () => {
    // Trap #3: a module that reads a sibling global at PARSE time dies
    // silently when the tag order shifts (this killed welcome.js). Two of
    // the celebration's callers already load before the player's tag, so
    // the guarantee has to be lazy resolution, not tag order.
    const html = readRepoFile("index.html");
    assert.ok(
      html.includes('src="onboarding-celebration.js"'),
      "the player has a script tag",
    );
    // The alias is the only thing that touches the player global, and it
    // reads it inside the function body.
    const wizard = readRepoFile("onboarding-wizard.js");
    const fnStart = wizard.indexOf("function playOnboardingCelebration");
    assert.ok(fnStart > 0);
    assert.ok(
      wizard.indexOf("window.JobBoredOnboardingCelebration") > fnStart,
      "the player global is read inside the alias, never captured at load",
    );
    for (const caller of [
      "first-run-wizard.js",
      "go-live-wizard-ui.js",
      "discovery-wizard-ui.js",
    ]) {
      const src = readRepoFile(caller);
      const idx = src.indexOf("playOnboardingCelebration");
      assert.ok(idx > 0, `${caller} calls the player`);
      const before = src.slice(Math.max(0, idx - 400), idx);
      assert.match(
        before,
        /window\.JobBoredApp\s*&&\s*\n?\s*window\.JobBoredApp\.onboarding|JobBoredApp\.onboarding/,
        `${caller} must resolve window.JobBoredApp.onboarding at call time`,
      );
    }
  });
});
