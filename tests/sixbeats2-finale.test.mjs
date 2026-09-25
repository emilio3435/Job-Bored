import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  loadCelebrationModule,
  loadPayoff,
  readRepoFile,
  textOf,
} from "./oneflow-l4-harness.mjs";
import { loadArrival, renderedText } from "./oneflow-l1-harness.mjs";

/* ============================================================
   SIXBEATS-2 lane `finale` — NEW-1, NEW-10, NEW-4.
   docs/programs/sixbeats2-20260902/SIXBEATS2-SPEC.md (locked decision 2).

   The observe-only acceptance rerun on main @ cf0da4d
   (evidence/rerun-09-02/REPORT.md) ended the whole six-beat walk on a
   screen the user could not use:

     NEW-1 (BLOCKER) — `#onboardingCelebration` mounted OVER Beat 6 as
       `role="dialog" aria-modal="true"`, `pointer-events: auto`,
       z-index 100002, carrying a second, older payoff (the three-circle
       ✓ PROFILE ✓ JOB DISCOVERY ✓ OTHER DEVICES strip, its own
       `See what happens now →` primary and an `or start with your other
       devices →` link). `Run discovery now` was covered for the whole
       29 870 ms sample and never uncovered itself.
     NEW-10 (UGLY) — Beat 6's sub-line renders twice: once as the shell
       lede, once as the first line of the beat body.
     NEW-4 (CONFUSING) — B2's promised "✓ Connected" line was on screen
       for ~106 ms (first sampled 1612 ms, replaced 1718 ms).

   Locked decision 2: the finale is NOT a modal. Confetti + title/sub
   float over the visible Beat 6 for ~2.5 s with `pointer-events: none`,
   then fade; no journey strip, no alt link, no CTA gate. Beat 6's
   actions are clickable from first paint, and the reduced-motion /
   a11y mechanics survive.

   The real-browser half of NEW-1 (a Playwright click through the burst,
   nothing dismissed programmatically) is
   tests/e2e-visual/finale-burst.spec.mjs.
   ============================================================ */

const CELEBRATION_CSS = readRepoFile("css/onboarding-celebration.css");

/** Play the finale the way B6 plays it. */
function playFinale(env, overrides = {}) {
  let done = 0;
  env.celebration.playOnboardingCelebration(
    () => {
      done += 1;
    },
    "flow_payoff",
    overrides,
  );
  return () => done;
}

describe("NEW-1 — the finale is a burst, not a modal (SIXBEATS2 decision 2)", () => {
  it("drops role=dialog and aria-modal so Beat 6 stays the screen", () => {
    // The rerun measured `role="dialog" aria-modal="true"` over the payoff:
    // an aria-modal overlay hides everything behind it from assistive tech,
    // which is exactly wrong for decoration floating over a live beat.
    const env = loadCelebrationModule();
    playFinale(env);
    assert.equal(env.overlay.getAttribute("role"), "status");
    assert.equal(env.overlay.hasAttribute("aria-modal"), false);
    assert.equal(env.overlay.getAttribute("aria-live"), "polite");
    assert.equal(env.overlay.getAttribute("aria-hidden"), "false");
  });

  it("removes the legacy journey strip, the CTA and the alt link", () => {
    // These three were the pre-SIXBEATS celebration's whole body: a second
    // payoff competing with the real one. Decision 2 deletes all three.
    const env = loadCelebrationModule();
    assert.ok(
      env.overlay.querySelector(".onboarding-celebration__journey"),
      "the fixture ships index.html's legacy strip",
    );
    playFinale(env);
    assert.equal(
      env.overlay.querySelector(".onboarding-celebration__journey"),
      null,
      "no journey strip — nothing is 'next' at B6",
    );
    assert.equal(
      env.overlay.querySelector(".onboarding-celebration__journey-step"),
      null,
    );
    assert.equal(
      env.overlay.querySelector(".onboarding-celebration__cta"),
      null,
      "no CTA gate — Beat 6's own actions are the way forward",
    );
    assert.equal(
      env.overlay.querySelector(".onboarding-celebration__alt"),
      null,
      "no 'or start with your other devices →' escape hatch",
    );
  });

  it("carries the burst class whose rule turns off pointer events", () => {
    const env = loadCelebrationModule();
    playFinale(env);
    assert.equal(
      env.overlay.classList.contains("onboarding-celebration--burst"),
      true,
    );
    const rule = CELEBRATION_CSS.match(
      /\.onboarding-celebration--burst\s*\{[^}]*\}/,
    );
    assert.ok(rule, "the burst variant has its own rule");
    assert.match(
      rule[0],
      /pointer-events:\s*none/,
      "clicks fall through to Beat 6 — NEW-1's whole failure",
    );
    assert.match(
      rule[0],
      /backdrop-filter:\s*none/,
      "the beat underneath stays legible, not blurred behind a scrim",
    );
  });

  it("never inerts the page and never steals focus from Beat 6", () => {
    // The old player inerted every body sibling so ITS cta could be clicked.
    // A non-blocking burst must leave the beat's own footer reachable — by
    // pointer and by keyboard.
    const env = loadCelebrationModule();
    playFinale(env);
    assert.equal(
      env.other.hasAttribute("inert"),
      false,
      "the rest of the page keeps working while the burst floats",
    );
    for (const el of Object.values(env.els)) {
      assert.notEqual(el.__focused, true, "the burst takes no focus");
    }
  });

  it("fades itself within 3 s and clears its confetti", () => {
    // "It does not go away on its own" is what made NEW-1 terminal.
    const env = loadCelebrationModule();
    const burst = env.els.onboardingCelebrationConfetti;
    const doneCount = playFinale(env);
    assert.ok(burst.children.length > 0, "confetti spawns");
    assert.equal(env.overlay.hidden, false, "the burst shows");
    assert.ok(env.timers.length >= 1, "a self-dismissal is scheduled");
    assert.ok(
      env.timers[0].ms <= 3000,
      `the burst clears in <= 3 s (scheduled at ${env.timers[0].ms} ms)`,
    );
    env.drainTimers();
    assert.equal(env.overlay.hidden, true, "hidden after the fade");
    assert.equal(burst.children.length, 0, "confetti cleared");
    assert.equal(doneCount(), 1, "the handoff still runs, exactly once");
  });

  it("keeps the finale copy the caller hands it, and nothing else", () => {
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
    assert.deepEqual(
      Object.keys(env.celebration.STAGES.flow_payoff).sort(),
      ["sub", "title"],
      "no cta and no journey index survive the stage config",
    );
  });

  it("still honours prefers-reduced-motion", () => {
    // The burst is dismissed by a timer, not by an animation end, so the
    // reduced-motion path cannot strand — but the motion itself must still
    // be suppressed, burst variant included.
    const reduced = CELEBRATION_CSS.match(
      /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\n\}/,
    );
    assert.ok(reduced, "the reduced-motion block survives");
    assert.match(reduced[0], /\.onboarding-celebration__confetti-piece/);
    assert.match(reduced[0], /display:\s*none/);
    assert.match(
      reduced[0],
      /\.onboarding-celebration--burst/,
      "the burst's own entrance is suppressed too",
    );
  });
});

describe("NEW-10 — Beat 6's sub-line renders exactly once (spec §5 B6)", () => {
  it("the shell lede is the only copy of the sub", async () => {
    const env = loadPayoff();
    await env.flow.goToBeat("payoff");
    await new Promise((r) => setTimeout(r, 0));
    const mount = env.document.getElementById("oneFlowMount");
    const sub = env.payoff.SUB;
    const occurrences = textOf(mount).split(sub).length - 1;
    assert.equal(
      occurrences,
      1,
      "the beat body must not restate the lede the shell already renders",
    );
    assert.equal(
      mount.querySelector(".oneflow-payoff__sub"),
      null,
      "the duplicated body paragraph is gone",
    );
  });

  it("the rest of the receipt is untouched", async () => {
    const env = loadPayoff();
    await env.flow.goToBeat("payoff");
    await new Promise((r) => setTimeout(r, 0));
    const mount = env.document.getElementById("oneFlowMount");
    assert.ok(mount.querySelector(".oneflow-payoff__search"), "Your search");
    assert.ok(mount.querySelector(".oneflow-payoff__now"), "What happens now");
    assert.ok(
      textOf(mount).includes(env.payoff.FOOTER_LINE),
      "the upgrades footer still ships",
    );
  });
});

describe("NEW-4 — B2 holds its success line before advancing (spec §5 B2)", () => {
  it("ships a hold of at least 1.2 s", () => {
    // The rerun clocked the promised "✓ Connected — <model> responded" line
    // at ~106 ms on screen: a reward the user cannot read is not a reward.
    const env = loadArrival();
    const hold = env.window.JobBoredOneFlowBeatAi._internal.timings.successHoldMs;
    assert.equal(typeof hold, "number");
    assert.ok(hold >= 1200, `the success line is held ${hold} ms (>= 1200)`);
  });

  it("stays on B2 while the success line is up, then advances", async () => {
    const env = loadArrival();
    await env.flow.open("ai");
    const ai = env.window.JobBoredOneFlowBeatAi;
    ai._internal.timings.successHoldMs = 400; // the shipped 1.4 s, sped up
    env.mount().querySelector('[data-provider="openrouter"]').dispatch("click");
    const field = env.mount().querySelector("#oneFlowAiKeyInput");
    field.value = "sk-or-v1-testkey";
    field.dispatch("input", { target: field });

    const pending = ai.handleAction("ai_check");
    let sawSuccessWhileOnBeat = false;
    for (let i = 0; i < 40; i += 1) {
      await new Promise((r) => setTimeout(r, 5));
      const connected = ai
        .getRenderedStages()
        .some((stage) => String(stage.label || "").startsWith("✓ Connected"));
      if (connected) {
        sawSuccessWhileOnBeat = env.flow.getState().beat === "ai";
        break;
      }
    }
    assert.equal(
      sawSuccessWhileOnBeat,
      true,
      "the ✓ Connected line is on screen while B2 is still the beat",
    );
    await pending;
    assert.equal(
      env.flow.getState().beat,
      "resume",
      "and the beat still advances once the hold is over",
    );
    assert.ok(
      renderedText(env.mount()).length > 0,
      "the flow kept rendering across the hold",
    );
  });
});
