/**
 * fuel-and-polish.spec.mjs — the SIXBEATS-2 lane's browser proof.
 *
 * Three of this lane's findings are geometry, and geometry is not something
 * a fake DOM can hold honestly:
 *
 *   · NEW-5 (BLOCKER) — the open demo-card detail sat on top of the
 *     collapsed "Set up JobBored — 15 min ▸" pill and swallowed its clicks,
 *     so a visitor who poked around first could not get back into the flow.
 *     Proven here by boxes that do not intersect and by a REAL click that
 *     opens the shell with the detail still on screen — no programmatic
 *     dismissal anywhere.
 *   · NEW-9 — B5's steps read `…no card needed).1 · Create your free
 *     account ↗`: no list marker, and the deep link inline behind the full
 *     stop. Proven by the marker being drawn and by the link owning its own
 *     line box.
 *   · NEW-13 — a long error toast rendered ~500px tall, one word per line,
 *     over the gate. Proven by measuring the real toast the app's own
 *     showToast() produces, with the same action button the rerun saw.
 *
 * Structure, boxes and computed styles only — no pixel baselines, for the
 * reasons the suite config gives.
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
  DESKTOP,
  goToBeat,
  openFlow,
  PHONE,
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

/** True when two boxes share any area at all. */
function intersects(a, b) {
  if (!a || !b) return false;
  return !(
    a.right <= b.left ||
    b.right <= a.left ||
    a.bottom <= b.top ||
    b.bottom <= a.top
  );
}

/** Collapse the ask to its pill and open the first demo card's detail. */
async function collapseAndOpenDetail(page) {
  await page.getByRole("button", { name: "Poke around first", exact: true }).click();
  await page.waitForSelector(".oneflow-demo__pill");
  await page.locator(".oneflow-demo__card").first().click();
  await page.waitForSelector(".oneflow-demo__detail");
  await settleLayout(page);
}

// ---------------------------------------------------------------
// NEW-5 — the demo detail is not a lid
// ---------------------------------------------------------------

for (const viewport of [DESKTOP, PHONE]) {
  const label = `${viewport.width}×${viewport.height}`;

  test.describe(`S0 demo detail at ${label}`, () => {
    test.use({ viewport });

    test(`should keep the setup pill clear of an open demo detail (${label})`, async ({
      page,
    }) => {
      const fence = await installHermeticNetworkFence(page, { baseUrl: app.baseUrl });
      await bootColdStart(page, app.baseUrl);
      await collapseAndOpenDetail(page);

      const detail = await boxOf(page, ".oneflow-demo__detail");
      const pill = await boxOf(page, ".oneflow-demo__pill");
      expect(detail, "the detail must be on screen for this to mean anything").not.toBeNull();
      expect(pill, "the collapsed ask must still be on screen").not.toBeNull();
      expect(
        intersects(detail, pill),
        `the detail covers the pill: detail=${JSON.stringify(detail)} pill=${JSON.stringify(pill)}`,
      ).toBe(false);

      // The box is only half the claim: the click has to land. No overlay is
      // dismissed first — the detail is still open when this fires.
      await page.locator(".oneflow-demo__pill").click();
      await expect(page.locator(`${SHELL}`)).toBeVisible();

      expect(fence.unexpectedExternal).toEqual([]);
    });

    test(`should close the demo detail from its own control and from Escape (${label})`, async ({
      page,
    }) => {
      const fence = await installHermeticNetworkFence(page, { baseUrl: app.baseUrl });
      await bootColdStart(page, app.baseUrl);
      await collapseAndOpenDetail(page);

      const close = page.locator(".oneflow-demo__detail-close");
      await expect(close).toBeVisible();
      const closeBox = await boxOfLocator(close);
      expect(closeBox.width, "a 24px target is the floor for a real control").toBeGreaterThanOrEqual(20);
      expect(closeBox.height).toBeGreaterThanOrEqual(20);
      await close.click();
      await expect(page.locator(".oneflow-demo__detail")).toHaveCount(0);

      // And again, by keyboard, from a fresh open.
      await page.locator(".oneflow-demo__card").first().click();
      await expect(page.locator(".oneflow-demo__detail")).toHaveCount(1);
      await page.keyboard.press("Escape");
      await expect(page.locator(".oneflow-demo__detail")).toHaveCount(0);

      expect(fence.unexpectedExternal).toEqual([]);
    });
  });
}

// ---------------------------------------------------------------
// NEW-9 — B5's numbered steps
// ---------------------------------------------------------------

for (const viewport of [DESKTOP, PHONE]) {
  const label = `${viewport.width}×${viewport.height}`;

  test.describe(`B5 fuel steps at ${label}`, () => {
    test.use({ viewport });

    test(`should draw a list marker and give each deep link its own line (${label})`, async ({
      page,
    }) => {
      const fence = await installHermeticNetworkFence(page, { baseUrl: app.baseUrl });
      await bootColdStart(page, app.baseUrl);
      await openFlow(page);
      await goToBeat(page, "discovery");

      const steps = await page.evaluate(() => {
        const list = globalThis.document.querySelector(".oneflow-fuel__steps");
        const listStyle = globalThis.getComputedStyle(list);
        return {
          listStyleType: listStyle.listStyleType,
          items: [...list.querySelectorAll(".oneflow-fuel__step")].map((li) => {
            const style = globalThis.getComputedStyle(li);
            const link = li.querySelector("a");
            const box = li.getBoundingClientRect();
            // The first line box of the step's own text.
            const range = globalThis.document.createRange();
            range.selectNodeContents(li.firstChild || li);
            const first = [...range.getClientRects()][0] || null;
            const linkBox = link ? link.getBoundingClientRect() : null;
            return {
              text: (li.textContent || "").trim(),
              display: style.display,
              linkDisplay: link ? globalThis.getComputedStyle(link).display : null,
              firstLineTop: first ? +first.top.toFixed(2) : null,
              firstLineBottom: first ? +first.bottom.toFixed(2) : null,
              linkTop: linkBox ? +linkBox.top.toFixed(2) : null,
              linkLeft: linkBox ? +linkBox.left.toFixed(2) : null,
              left: +box.left.toFixed(2),
            };
          }),
        };
      });

      expect(steps.listStyleType, "no marker is why the steps typed their own").toBe(
        "decimal",
      );
      expect(steps.items.length).toBe(3);
      for (const item of steps.items) {
        expect(item.display, `step is not a list item: ${JSON.stringify(item)}`).toBe(
          "list-item",
        );
        expect(
          item.text,
          "the digits are the list's job now, not the sentence's",
        ).not.toMatch(/^\d+\.\s/);
        if (!item.linkTop) continue;
        // A block link starts a line of its own; an inline one shares the
        // last line of the sentence, which is exactly the glue NEW-9 saw.
        expect(item.linkDisplay).toBe("block");
        expect(
          item.linkTop,
          `the deep link shares a line with the sentence: ${JSON.stringify(item)}`,
        ).toBeGreaterThanOrEqual(item.firstLineBottom - 1);
      }

      expect(fence.unexpectedExternal).toEqual([]);
    });
  });
}

// ---------------------------------------------------------------
// NEW-13 — the toast
// ---------------------------------------------------------------

/** The exact string the rerun's Path B boot put on screen. */
const RERUN_TOAST =
  "The discovery worker needs a webhook secret. The browser-use worker " +
  "fail-closes on empty or mismatched x-discovery-secret. Run " +
  "`npm run discovery:bootstrap-local` on this machine and reload — the " +
  "dashboard autofills the secret. Or paste it into Discovery drawer → " +
  "Connection → Discovery webhook secret.";

for (const viewport of [DESKTOP, PHONE]) {
  const label = `${viewport.width}×${viewport.height}`;

  test.describe(`toast at ${label}`, () => {
    test.use({ viewport });

    test(`should wrap a long toast like prose, never one word per line (${label})`, async ({
      page,
    }) => {
      const fence = await installHermeticNetworkFence(page, { baseUrl: app.baseUrl });
      await bootColdStart(page, app.baseUrl);

      await page.evaluate((text) => {
        globalThis.showToast(text, "error", true, {
          label: "Copy bootstrap command",
          onClick() {},
        });
      }, RERUN_TOAST);
      await page.waitForSelector(".toast");
      await settleLayout(page);

      const measured = await page.evaluate(() => {
        const toast = globalThis.document.querySelector(".toast");
        const message = toast.querySelector(".toast-message");
        const range = globalThis.document.createRange();
        range.selectNodeContents(message);
        const lines = [...range.getClientRects()].filter(
          (r) => r.width > 0 && r.height > 0,
        );
        const box = toast.getBoundingClientRect();
        const messageBox = message.getBoundingClientRect();
        return {
          width: +box.width.toFixed(2),
          height: +box.height.toFixed(2),
          messageWidth: +messageBox.width.toFixed(2),
          lineCount: lines.length,
          lineWidths: lines.map((r) => +r.width.toFixed(2)),
        };
      });

      expect(
        measured.width,
        `the toast is ${measured.width}px wide: ${JSON.stringify(measured)}`,
      ).toBeLessThanOrEqual(viewport.width < 480 ? viewport.width : 421);
      expect(
        measured.height,
        `a 500px-tall toast is a wall, not a notification: ${JSON.stringify(measured)}`,
      ).toBeLessThan(340);
      // "One word per line" measured honestly: with ~355px of message the
      // rerun's string needed 20+ lines. A sane wrap fits it in far fewer,
      // and every full line uses most of the width it was given.
      expect(
        measured.lineCount,
        `${measured.lineCount} line boxes for one sentence: ${JSON.stringify(measured)}`,
      ).toBeLessThanOrEqual(14);
      const fullLines = measured.lineWidths.slice(0, -1);
      for (const width of fullLines) {
        expect(
          width,
          `a line only ${width}px of ${measured.messageWidth}px wide is the one-word column: ${JSON.stringify(measured)}`,
        ).toBeGreaterThan(measured.messageWidth * 0.5);
      }

      expect(fence.unexpectedExternal).toEqual([]);
    });
  });
}
