/**
 * shell-structure.spec.mjs — the visual gate for the one shell (claims U2, C7).
 *
 * U2: the flow rendered the six-segment spine AND a legacy step rail beneath
 * it AND a "Step 1 of 1" kicker inside the beat card AND a footer note
 * pointing at the rail — four things claiming to say where you are, against
 * spec §2's "ONE spine". Lane V2 cut it to one and framed the shell.
 *
 * C7: at 390×844 beats 4–5 ran long and the actions were not reachable
 * without scrolling to the bottom of the card. V2 gave the phone a sticky
 * dock and made the body the single scroll region.
 *
 * The gate walks all six beats at both viewports, because "one spine" and
 * "the actions are under the thumb" are claims about EVERY beat, and the two
 * that broke (4 and 5) are the two a shorter walk would skip.
 */

import { test, expect } from "@playwright/test";
import {
  installHermeticNetworkFence,
  startHermeticApp,
} from "../e2e-fixtures/hermetic-harness.mjs";
import {
  BEAT_IDS,
  boxOf,
  boxOfLocator,
  bootColdStart,
  DESKTOP,
  goToBeat,
  horizontalOverflow,
  isInsideViewport,
  openFlow,
  PHONE,
  PROGRESS_INDICATOR_SELECTORS,
  settleLayout,
  SHELL,
} from "./visual-gate-helpers.mjs";

let app = null;

test.beforeAll(async () => {
  app = await startHermeticApp();
});

test.afterAll(async () => {
  if (app) await app.close();
});

for (const viewport of [DESKTOP, PHONE]) {
  const label = `${viewport.width}×${viewport.height}`;

  test.describe(`the one shell at ${label}`, () => {
    test.use({ viewport });

    test(`should carry a header strip with the flow's title and its Close control (${label})`, async ({
      page,
    }) => {
      // Spec §3.5: the shell is the product's chrome for the whole setup, so
      // it names itself and offers the way out in one row. V2's 480px rules
      // exist because the chassis' 760px stack turned Close into a
      // full-width bar above the title.
      const fence = await installHermeticNetworkFence(page, {
        baseUrl: app.baseUrl,
      });
      await bootColdStart(page, app.baseUrl);
      await openFlow(page);

      const header = page.locator(`${SHELL} .discovery-setup-wizard__header`);
      await expect(header).toBeVisible();
      await expect(
        header.locator(".discovery-setup-wizard__title"),
      ).toHaveText("Set up JobBored");
      const close = header.locator(".discovery-setup-wizard__close");
      await expect(close).toBeVisible();

      const headerBox = await boxOf(
        page,
        `${SHELL} .discovery-setup-wizard__header`,
      );
      const titleBox = await boxOfLocator(
        header.locator(".discovery-setup-wizard__title"),
      );
      const closeBox = await boxOfLocator(close);
      // One row: the title and Close share a line rather than stacking.
      expect(
        Math.abs(titleBox.top - closeBox.top),
        `title and Close must sit on one row: title=${JSON.stringify(titleBox)} close=${JSON.stringify(closeBox)}`,
      ).toBeLessThan(titleBox.height + 8);
      expect(closeBox.right).toBeLessThanOrEqual(headerBox.right + 1);
      expect(
        isInsideViewport(closeBox, viewport),
        `Close must be on screen: ${JSON.stringify(closeBox)}`,
      ).toBe(true);

      expect(fence.unexpectedExternal).toEqual([]);
    });

    test(`should show exactly one progress indicator on every beat (${label})`, async ({
      page,
    }) => {
      // Claim U2, asserted the way the claim is written: COUNT the things
      // that say where you are. One six-segment spine, no revived rail, no
      // "Step N of M" anywhere in the shell.
      const fence = await installHermeticNetworkFence(page, {
        baseUrl: app.baseUrl,
      });
      await bootColdStart(page, app.baseUrl);
      await openFlow(page);

      for (const beat of BEAT_IDS) {
        await goToBeat(page, beat);

        const counts = await page.evaluate((selectors) => {
          const shell = globalThis.document.querySelector(
            ".discovery-setup-wizard--spine",
          );
          const found = {};
          let total = 0;
          for (const selector of selectors) {
            const n = shell.querySelectorAll(selector).length;
            if (n) found[selector] = n;
            total += n;
          }
          return {
            total,
            found,
            segments: shell.querySelectorAll(
              ".discovery-setup-wizard__spine-step",
            ).length,
            current: shell.querySelectorAll(
              ".discovery-setup-wizard__spine-step--current",
            ).length,
            stepOfText: /step\s+\d+\s+of\s+\d+/i.test(shell.textContent || ""),
          };
        }, PROGRESS_INDICATOR_SELECTORS);

        expect(
          counts.total,
          `beat "${beat}" must have ONE progress system, found ${JSON.stringify(counts.found)}`,
        ).toBe(1);
        expect(counts.found[".discovery-setup-wizard__spine"]).toBe(1);
        expect(
          counts.segments,
          `beat "${beat}" spine must carry the six segments spec §3.5.1 locks`,
        ).toBe(6);
        expect(
          counts.current,
          `beat "${beat}" must mark exactly one segment current`,
        ).toBe(1);
        expect(
          counts.stepOfText,
          `beat "${beat}" must not re-add a "Step N of M" counter`,
        ).toBe(false);

        // The current segment is this beat's, not a stale one.
        await expect(
          page.locator(
            `${SHELL} .discovery-setup-wizard__spine-step--current`,
          ),
        ).toHaveAttribute("data-beat-id", beat);
      }

      expect(fence.unexpectedExternal).toEqual([]);
    });

    test(`should never scroll sideways on any beat (${label})`, async ({
      page,
    }) => {
      // The shell has three nested boxes that can each grow past their
      // parent — the dialog, its scrolling body, and the beat's frame. A
      // sideways scrollbar in any of them is a broken layout on a phone.
      const fence = await installHermeticNetworkFence(page, {
        baseUrl: app.baseUrl,
      });
      await bootColdStart(page, app.baseUrl);
      await openFlow(page);

      for (const beat of BEAT_IDS) {
        await goToBeat(page, beat);
        const overflow = await horizontalOverflow(page, [
          SHELL,
          `${SHELL} .discovery-setup-wizard__body`,
          `${SHELL} .discovery-setup-wizard__frame`,
          `${SHELL} .discovery-setup-wizard__step-content`,
        ]);
        expect(
          overflow.document.scrollWidth,
          `beat "${beat}": globalThis.document overflows ${JSON.stringify(overflow.document)}`,
        ).toBeLessThanOrEqual(overflow.document.clientWidth + 1);
        for (const [selector, region] of Object.entries(overflow.regions)) {
          expect(
            region.scrollWidth,
            `beat "${beat}": ${selector} overflows ${JSON.stringify(region)}`,
          ).toBeLessThanOrEqual(region.clientWidth + 1);
        }
      }

      expect(fence.unexpectedExternal).toEqual([]);
    });

    test(`should keep the shell inside the viewport it was given (${label})`, async ({
      page,
    }) => {
      // The desktop shell is a centred dialog; the phone shell is full-bleed
      // and exactly one viewport tall (V2's `height: 100dvh`), which is what
      // makes a sticky dock a dock. Either way nothing hangs off an edge.
      const fence = await installHermeticNetworkFence(page, {
        baseUrl: app.baseUrl,
      });
      await bootColdStart(page, app.baseUrl);
      await openFlow(page);

      const shellBox = await boxOf(page, SHELL);
      expect(
        isInsideViewport(shellBox, viewport, 2),
        `the shell must fit its viewport: ${JSON.stringify(shellBox)}`,
      ).toBe(true);
      expect(shellBox.width).toBeLessThanOrEqual(viewport.width + 1);

      expect(fence.unexpectedExternal).toEqual([]);
    });
  });
}

test.describe("the one shell on a phone — claim C7", () => {
  test.use({ viewport: PHONE });

  test("should keep every beat's actions reachable without scrolling", async ({
    page,
  }) => {
    // Claim C7, stated as geometry: on a 390×844 phone the footer's action
    // buttons must be inside the viewport on FIRST paint of every beat, with
    // the body scrolled to the top. Beats 4 and 5 are the two that failed —
    // their cards ran past the fold and took the actions with them.
    const fence = await installHermeticNetworkFence(page, {
      baseUrl: app.baseUrl,
    });
    await bootColdStart(page, app.baseUrl);
    await openFlow(page);

    for (const beat of BEAT_IDS) {
      await goToBeat(page, beat);

      // The dock only counts if the visitor has not scrolled for it.
      await page.evaluate(() => {
        const body = globalThis.document.querySelector(
          ".discovery-setup-wizard--spine .discovery-setup-wizard__body",
        );
        if (body) body.scrollTop = 0;
        globalThis.window.scrollTo(0, 0);
      });

      const footer = page.locator(
        `${SHELL} .discovery-setup-wizard__footer--dock`,
      );
      await expect(
        footer,
        `beat "${beat}" must dock its footer on a phone`,
      ).toBeVisible();

      const buttons = page.locator(
        `${SHELL} .discovery-setup-wizard__actions button`,
      );
      const count = await buttons.count();
      expect(count, `beat "${beat}" must offer at least one action`).toBeGreaterThan(0);
      for (let i = 0; i < count; i += 1) {
        const button = buttons.nth(i);
        const box = await boxOfLocator(button);
        const name = (await button.textContent()) || "";
        expect(
          isInsideViewport(box, PHONE, 2),
          `beat "${beat}" action "${name.trim().slice(0, 40)}" is off screen: ${JSON.stringify(box)}`,
        ).toBe(true);
      }

      // And the one scroll region behind the dock is the body, not the
      // frame: two nested scrollers is how the actions got stranded.
      const scrollers = await page.evaluate(() => {
        const pick = (sel) => {
          const n = globalThis.document.querySelector(sel);
          if (!n) return null;
          const s = globalThis.getComputedStyle(n);
          return {
            overflowY: s.overflowY,
            scrolls: n.scrollHeight > n.clientHeight + 1,
          };
        };
        return {
          body: pick(
            ".discovery-setup-wizard--spine .discovery-setup-wizard__body",
          ),
          frame: pick(
            ".discovery-setup-wizard--spine .discovery-setup-wizard__frame",
          ),
        };
      });
      expect(
        scrollers.body.overflowY,
        `beat "${beat}": the body is the phone's scroll region`,
      ).toBe("auto");
      expect(
        scrollers.frame.overflowY,
        `beat "${beat}": the frame must not be a second scroller`,
      ).toBe("visible");
    }

    expect(fence.unexpectedExternal).toEqual([]);
  });

  test("should dock the footer at the bottom of the viewport, not the bottom of the card", async ({
    page,
  }) => {
    // The distinction C7 turns on: a footer at the end of a long card is
    // below the fold; a footer stuck to the viewport is under the thumb.
    const fence = await installHermeticNetworkFence(page, {
      baseUrl: app.baseUrl,
    });
    await bootColdStart(page, app.baseUrl);
    await openFlow(page);
    await goToBeat(page, "fit");

    const footerBox = await boxOf(
      page,
      `${SHELL} .discovery-setup-wizard__footer--dock`,
    );
    expect(
      footerBox.bottom,
      `the dock must reach the bottom edge of the phone: ${JSON.stringify(footerBox)}`,
    ).toBeGreaterThanOrEqual(PHONE.height - 2);
    expect(footerBox.bottom).toBeLessThanOrEqual(PHONE.height + 2);

    const position = await page.evaluate(
      () =>
        globalThis.getComputedStyle(
          globalThis.document.querySelector(
            ".discovery-setup-wizard--spine .discovery-setup-wizard__footer--dock",
          ),
        ).position,
    );
    expect(position).toBe("sticky");

    // Scrolling the long beat must not carry the dock away with it.
    await page.evaluate(() => {
      const body = globalThis.document.querySelector(
        ".discovery-setup-wizard--spine .discovery-setup-wizard__body",
      );
      if (body) body.scrollTop = body.scrollHeight;
    });
    await settleLayout(page);
    const afterScroll = await boxOf(
      page,
      `${SHELL} .discovery-setup-wizard__footer--dock`,
    );
    expect(
      Math.abs(afterScroll.bottom - footerBox.bottom),
      "the dock stays put while the body scrolls",
    ).toBeLessThan(2);

    expect(fence.unexpectedExternal).toEqual([]);
  });
});
