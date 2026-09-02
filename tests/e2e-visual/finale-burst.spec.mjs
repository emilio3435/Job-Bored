/**
 * finale-burst.spec.mjs — the real-browser proof for SIXBEATS2 NEW-1.
 *
 * The acceptance rerun on main @ cf0da4d could not finish the flow. Beat 6
 * painted, and `#onboardingCelebration` painted on top of it:
 * `role="dialog" aria-modal="true"`, `pointer-events: auto`, z-index 100002,
 * 1440×900 at (0,0), carrying a second older payoff with its own
 * `See what happens now →` primary. Sampled every 250 ms with
 * `document.elementFromPoint` at the centre of `Run discovery now`, the
 * payoff's own primary was covered for the whole 29 870 ms sample and was
 * still covered at the end. The rerun's click had to be FORCED through.
 *
 * So this spec forces nothing. It reaches Beat 6, waits for the finale to
 * actually be up, and then clicks the beat's primary the way a person does —
 * Playwright's actionability check hit-tests the point it is about to click,
 * so an intercepting overlay fails the click instead of being dismissed.
 *
 * Locked decision 2 is what it asserts: confetti + title/sub float over a
 * VISIBLE, CLICKABLE Beat 6 for ~2.5 s with `pointer-events: none`, then
 * fade — no journey strip, no alt link, no CTA gate.
 */

import { test, expect } from "@playwright/test";
import {
  installHermeticNetworkFence,
  startHermeticApp,
} from "../e2e-fixtures/hermetic-harness.mjs";
import {
  bootColdStart,
  DESKTOP,
  FLOW_MOUNT,
  openFlow,
  PHONE,
} from "./visual-gate-helpers.mjs";

const OVERLAY = "#onboardingCelebration";
const RUN_NOW = "Run discovery now";

let app = null;

test.beforeAll(async () => {
  app = await startHermeticApp();
});

test.afterAll(async () => {
  if (app) await app.close();
});

/**
 * Drive the controller to Beat 6.
 *
 * Deliberately NOT the shared `goToBeat` helper: that one calls
 * `settleLayout`, which awaits every running animation — including the
 * 1.6 s confetti — and would spend most of the 2.5 s burst before a single
 * assertion ran. Here the burst IS the subject, so the wait is for the
 * burst, not for the animations to be over.
 */
async function openPayoff(page) {
  await page.evaluate(() => globalThis.JobBoredOneFlow.goToBeat("payoff"));
  await page.waitForFunction(
    () =>
      globalThis.document.querySelector("#oneFlowMount .oneflow-beat")?.dataset
        .beatId === "payoff",
  );
}

/**
 * Put the burst up on demand.
 *
 * B6 fires it once per page on its own — asserted below — but "is it up
 * right now" is a 2.5 s window, and a probe that races it would flake into
 * a false green on the very claim that matters. Replaying the burst is the
 * opposite of dismissing one: it guarantees the overlay is on screen at the
 * moment the click is attempted.
 */
async function raiseBurst(page) {
  await page.evaluate(() => {
    globalThis.JobBoredOnboardingCelebration.playOnboardingCelebration(
      () => {},
      "flow_payoff",
      { title: "You're live.", sub: "That was the one-time part." },
    );
  });
  await page.waitForSelector(`${OVERLAY}.onboarding-celebration--in`, {
    state: "attached",
  });
}

for (const viewport of [DESKTOP, PHONE]) {
  const label = `${viewport.width}×${viewport.height}`;

  test.describe(`the B6 finale at ${label}`, () => {
    test.use({ viewport });

    test(`should fire on Beat 6 and clear itself, carrying no second payoff (${label})`, async ({
      page,
    }) => {
      const fence = await installHermeticNetworkFence(page, {
        baseUrl: app.baseUrl,
      });
      await bootColdStart(page, app.baseUrl);
      await openFlow(page);
      await openPayoff(page);

      // The one celebration still plays — decision 2 changed its shape, not
      // whether B6 has a payoff moment.
      await page.waitForSelector(`${OVERLAY}.onboarding-celebration--in`, {
        state: "attached",
      });

      const shape = await page.evaluate((sel) => {
        const overlay = globalThis.document.querySelector(sel);
        const style = globalThis.getComputedStyle(overlay);
        return {
          role: overlay.getAttribute("role"),
          ariaModal: overlay.getAttribute("aria-modal"),
          ariaLive: overlay.getAttribute("aria-live"),
          pointerEvents: style.pointerEvents,
          journey: !!overlay.querySelector(".onboarding-celebration__journey"),
          cta: !!overlay.querySelector(".onboarding-celebration__cta"),
          alt: !!overlay.querySelector(".onboarding-celebration__alt"),
          confetti: overlay.querySelectorAll(
            ".onboarding-celebration__confetti-piece",
          ).length,
        };
      }, OVERLAY);

      expect(shape.role, "not a dialog — decoration over a live beat").toBe(
        "status",
      );
      expect(shape.ariaModal, "nothing is modal at B6").toBeNull();
      expect(shape.ariaLive).toBe("polite");
      expect(shape.pointerEvents, "NEW-1: clicks fall through").toBe("none");
      expect(shape.journey, "no three-circle journey strip").toBe(false);
      expect(shape.cta, "no 'See what happens now →' gate").toBe(false);
      expect(shape.alt, "no 'or start with your other devices →' link").toBe(
        false,
      );
      expect(shape.confetti, "it is still a celebration").toBeGreaterThan(0);

      // "It does not go away on its own" is what made NEW-1 terminal.
      await page.waitForFunction(
        (sel) => globalThis.document.querySelector(sel).hasAttribute("hidden"),
        OVERLAY,
        { timeout: 8_000 },
      );

      expect(fence.unexpectedExternal).toEqual([]);
    });

    test(`should let Run discovery now be clicked while the burst is up (${label})`, async ({
      page,
    }) => {
      const fence = await installHermeticNetworkFence(page, {
        baseUrl: app.baseUrl,
      });
      await bootColdStart(page, app.baseUrl);
      await openFlow(page);
      await openPayoff(page);
      await raiseBurst(page);

      const primary = page.getByRole("button", { name: RUN_NOW, exact: true });
      await expect(primary).toBeVisible();

      // The rerun's own measurement, repeated: what is actually on top of
      // the payoff's primary right now?
      const topmost = await page.evaluate((name) => {
        const button = [
          ...globalThis.document.querySelectorAll(
            "#oneFlowMount .discovery-setup-wizard__btn",
          ),
        ].find((el) => (el.textContent || "").trim() === name);
        const box = button.getBoundingClientRect();
        const hit = globalThis.document.elementFromPoint(
          box.left + box.width / 2,
          box.top + box.height / 2,
        );
        return {
          overlayUp: !globalThis.document
            .querySelector("#onboardingCelebration")
            .hasAttribute("hidden"),
          hitIsTheButton: hit === button || button.contains(hit),
          hitClass: hit ? hit.className : null,
        };
      }, RUN_NOW);

      expect(topmost.overlayUp, "the burst is on screen for this click").toBe(
        true,
      );
      expect(
        topmost.hitIsTheButton,
        `the payoff's primary is the topmost element (got ${topmost.hitClass})`,
      ).toBe(true);

      // No force, no programmatic dismissal: Playwright hit-tests before it
      // clicks, so an intercepting overlay fails here instead of hiding.
      await primary.click({ timeout: 5_000 });

      // And the beat answers. On a hermetic cold start there is no saved fit
      // profile, so B6's intent guard is the honest response; a run that
      // fires is the other. Either proves the click reached the beat.
      await page.waitForFunction(
        (mountSel) => {
          const mount = globalThis.document.querySelector(mountSel);
          if (!mount) return true; // the shell closed — the run went out
          const text = mount.textContent || "";
          return (
            text.includes("Sending your search…") ||
            text.includes("no target roles or keywords yet")
          );
        },
        FLOW_MOUNT,
        { timeout: 10_000 },
      );

      expect(fence.unexpectedExternal).toEqual([]);
    });
  });
}

test.describe("the B6 finale under prefers-reduced-motion", () => {
  test.use({ viewport: DESKTOP });

  test("should still show, still clear itself, and still not block the beat", async ({
    page,
  }) => {
    // Emulated on the page rather than through a context option: the media
    // state has to be in force before the first paint AND provably in force
    // when the confetti is measured, which the assertion below checks.
    await page.emulateMedia({ reducedMotion: "reduce" });
    // The burst is dismissed by a timer rather than an animation end, so
    // suppressing the motion must not strand the overlay on screen — which
    // would recreate NEW-1 for exactly the users least able to work around it.
    const fence = await installHermeticNetworkFence(page, {
      baseUrl: app.baseUrl,
    });
    await bootColdStart(page, app.baseUrl);
    await openFlow(page);
    await openPayoff(page);
    await raiseBurst(page);

    const motion = await page.evaluate((sel) => {
      const overlay = globalThis.document.querySelector(sel);
      const piece = overlay.querySelector(
        ".onboarding-celebration__confetti-piece",
      );
      return {
        emulated: globalThis.matchMedia("(prefers-reduced-motion: reduce)")
          .matches,
        pieces: overlay.querySelectorAll(
          ".onboarding-celebration__confetti-piece",
        ).length,
        pointerEvents: globalThis.getComputedStyle(overlay).pointerEvents,
        titleVisible: !!overlay
          .querySelector(".onboarding-celebration__title")
          ?.getBoundingClientRect().height,
        confettiDisplay: piece
          ? globalThis.getComputedStyle(piece).display
          : "none",
      };
    }, OVERLAY);

    expect(motion.emulated, "the browser really is in reduced motion").toBe(
      true,
    );
    expect(motion.pointerEvents).toBe("none");
    expect(motion.titleVisible, "the payoff line still reads").toBe(true);
    expect(motion.confettiDisplay, "no falling pieces").toBe("none");

    await page
      .getByRole("button", { name: RUN_NOW, exact: true })
      .click({ timeout: 5_000 });

    await page.waitForFunction(
      (sel) => globalThis.document.querySelector(sel).hasAttribute("hidden"),
      OVERLAY,
      { timeout: 8_000 },
    );

    expect(fence.unexpectedExternal).toEqual([]);
  });
});
