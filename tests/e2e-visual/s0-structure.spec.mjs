/**
 * s0-structure.spec.mjs — the visual gate for screen S0 (SIXBEATS claim U1).
 *
 * U1 said the first pixel a stranger sees was "hot garbage": a bare kanban of
 * demo cards with no page header or wordmark, no framing, and the invitation
 * collapsed to a corner pill while most of the viewport sat empty
 * (`evidence/s0-as-shipped-emilio.png`). Lane V1 rebuilt it. These are the
 * assertions that keep it rebuilt.
 *
 * Structure, boxes and computed styles only — no pixel baselines. Fonts
 * rasterize differently on every machine, so a screenshot hash would fail for
 * reasons that have nothing to do with U1.
 */

import { test, expect } from "@playwright/test";
import {
  installHermeticNetworkFence,
  startHermeticApp,
} from "../e2e-fixtures/hermetic-harness.mjs";
import {
  boxOf,
  boxOfLocator,
  bootColdStart,
  DEMO_BOARD,
  DESKTOP,
  horizontalOverflow,
  INVITE_PRIMARY,
  INVITE_SECONDARY,
  isInsideBox,
  isInsideViewport,
  PHONE,
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

  test.describe(`S0 at ${label}`, () => {
    test.use({ viewport });

    test(`should open on a header strip carrying the wordmark and the sample-pipeline eyebrow (${label})`, async ({
      page,
    }) => {
      // U1's first half: the shipped screen named neither the product nor the
      // fact that the rows were a sample. A stranger cannot tell a demo from
      // a dashboard without chrome that says so.
      const fence = await installHermeticNetworkFence(page, {
        baseUrl: app.baseUrl,
      });
      await bootColdStart(page, app.baseUrl);

      const header = page.locator(".oneflow-demo__header");
      await expect(header).toBeVisible();
      await expect(header.locator(".oneflow-demo__wordmark")).toBeVisible();
      await expect(header.locator(".oneflow-demo__note")).toHaveText(
        "Sample pipeline — this is what a set-up JobBored looks like.",
      );

      const headerBox = await boxOf(page, ".oneflow-demo__header");
      expect(headerBox.top, "the strip is the top of the page").toBeLessThanOrEqual(1);
      expect(
        headerBox.width,
        "the strip spans the viewport rather than floating in a column",
      ).toBeGreaterThanOrEqual(viewport.width - 1);
      expect(headerBox.height, "the strip is one line of chrome, not a hero").toBeGreaterThan(
        24,
      );
      expect(headerBox.height).toBeLessThan(96);

      expect(fence.unexpectedExternal).toEqual([]);
    });

    test(`should show the invitation card on first mount with both actions on screen (${label})`, async ({
      page,
    }) => {
      // U1's second half, and the reason V1 deleted the persisted collapse
      // flag: the founder's screenshot opened on the corner pill because an
      // earlier visit had collapsed the ask. First mount must be the ask.
      const fence = await installHermeticNetworkFence(page, {
        baseUrl: app.baseUrl,
      });
      await bootColdStart(page, app.baseUrl);

      const invite = page.locator(".oneflow-demo__invite");
      await expect(invite).toBeVisible();
      await expect(page.locator(".oneflow-demo__pill")).toHaveCount(0);

      const inviteBox = await boxOf(page, ".oneflow-demo__invite");
      expect(
        isInsideViewport(inviteBox, viewport),
        `the invitation must be wholly on screen without scrolling: ${JSON.stringify(inviteBox)}`,
      ).toBe(true);

      // "About fifteen focused minutes" is the ask; a visitor cannot accept
      // what is below the fold.
      for (const name of [INVITE_PRIMARY, INVITE_SECONDARY]) {
        const button = invite.getByRole("button", { name, exact: true });
        await expect(button).toBeVisible();
        const box = await boxOfLocator(button);
        expect(
          isInsideViewport(box, viewport),
          `"${name}" must be reachable without scrolling: ${JSON.stringify(box)}`,
        ).toBe(true);
      }

      expect(fence.unexpectedExternal).toEqual([]);
    });

    test(`should sit the invitation on the framed board, not loose on the page (${label})`, async ({
      page,
    }) => {
      // Spec §4 "value first, ask on top". The frame is what turns "some
      // cards on a page" into "this is the screen you are buying", and the
      // shipped ask was `position: fixed` to the window instead — which is
      // how it ended up half-clipped at the bottom edge.
      const fence = await installHermeticNetworkFence(page, {
        baseUrl: app.baseUrl,
      });
      await bootColdStart(page, app.baseUrl);

      await expect(page.locator(".oneflow-demo__frame")).toBeVisible();
      const frame = await boxOf(page, ".oneflow-demo__frame");
      const ask = await boxOf(page, ".oneflow-demo__ask");
      expect(
        isInsideBox(ask, frame, 2),
        `the ask must live inside the frame: ask=${JSON.stringify(ask)} frame=${JSON.stringify(frame)}`,
      ).toBe(true);

      // The board it is asking about has to still be there behind it.
      await expect(
        page.locator(`${DEMO_BOARD} .oneflow-demo__card`).first(),
      ).toBeVisible();
      expect(
        await page.locator(`${DEMO_BOARD} .oneflow-demo__column`).count(),
      ).toBeGreaterThan(0);

      expect(fence.unexpectedExternal).toEqual([]);
    });

    test(`should never scroll sideways (${label})`, async ({ page }) => {
      // A horizontal scrollbar on the first screen is the loudest possible
      // "this layout broke" signal, and the one thing a 390px phone cannot
      // hide. Both scrollers are measured: the document, and S0's own
      // `overflow: auto` overlay root.
      const fence = await installHermeticNetworkFence(page, {
        baseUrl: app.baseUrl,
      });
      await bootColdStart(page, app.baseUrl);

      const overflow = await horizontalOverflow(page, [
        ".oneflow-demo",
        ".oneflow-demo__frame",
        ".oneflow-demo__board",
      ]);
      expect(
        overflow.document.scrollWidth,
        `globalThis.document overflows: ${JSON.stringify(overflow.document)}`,
      ).toBeLessThanOrEqual(overflow.document.clientWidth + 1);
      for (const [selector, region] of Object.entries(overflow.regions)) {
        expect(
          region.scrollWidth,
          `${selector} overflows: ${JSON.stringify(region)}`,
        ).toBeLessThanOrEqual(region.clientWidth + 1);
      }

      // Every card has to be inside the frame that is selling it — a card
      // clipped by the frame edge reads as a rendering bug, not a sample.
      const frame = await boxOf(page, ".oneflow-demo__frame");
      const cards = await page.evaluate(() =>
        [...globalThis.document.querySelectorAll(".oneflow-demo__card")].map((n) => {
          const r = n.getBoundingClientRect();
          return { left: +r.left.toFixed(2), right: +r.right.toFixed(2), top: +r.top.toFixed(2), bottom: +r.bottom.toFixed(2) };
        }),
      );
      expect(cards.length).toBeGreaterThan(0);
      for (const card of cards) {
        expect(card.left, `card escapes the frame: ${JSON.stringify(card)}`).toBeGreaterThanOrEqual(
          frame.left - 2,
        );
        expect(card.right, `card escapes the frame: ${JSON.stringify(card)}`).toBeLessThanOrEqual(
          frame.right + 2,
        );
      }

      expect(fence.unexpectedExternal).toEqual([]);
    });

    test(`should leave a fully visible pill behind when the ask is collapsed (${label})`, async ({
      page,
    }) => {
      // Spec §4: "Poke around first" escapes the ask, never the deal. A pill
      // half off the bottom edge — which is exactly what the founder's
      // screenshot shows — is the same as no way back in.
      const fence = await installHermeticNetworkFence(page, {
        baseUrl: app.baseUrl,
      });
      await bootColdStart(page, app.baseUrl);

      await page
        .getByRole("button", { name: INVITE_SECONDARY, exact: true })
        .click();

      const pill = page.locator(".oneflow-demo__pill");
      await expect(pill).toBeVisible();
      const pillBox = await boxOf(page, ".oneflow-demo__pill");
      expect(
        isInsideViewport(pillBox, viewport),
        `the pill must stay wholly on screen: ${JSON.stringify(pillBox)}`,
      ).toBe(true);
      // One line, never a wrapped two-line chip.
      expect(pillBox.height).toBeLessThan(56);

      // And the board it re-enters from is still standing.
      await expect(
        page.locator(`${DEMO_BOARD} .oneflow-demo__card`).first(),
      ).toBeVisible();

      expect(fence.unexpectedExternal).toEqual([]);
    });
  });
}
