/**
 * inline-actions.spec.mjs — claim U3: a control's label is not prose.
 *
 * Routed to Q1 from the orchestrator's review of the V1/V2 screenshots:
 * in `after-beat4-390x844.png` the "Add" buttons beside the role and
 * strength inputs wrap to "Ad / d".
 *
 * The mechanism (measured, not guessed): the shared wizard chassis sets
 * `overflow-wrap: anywhere` on `.discovery-setup-wizard__step-content` so an
 * unbreakable webhook secret or shell command cannot turn a step into a
 * horizontal scroller. That inherits into every beat's controls. The chip
 * rows are flex rows whose input carries `width: 100%`, so the button beside
 * it is squeezed to min-content — and with `overflow-wrap: anywhere` in
 * force, min-content is one CHARACTER. The label breaks mid-word.
 *
 * The gate is a bounding-box check, per the kickoff: a single-word control
 * label must occupy exactly one line box, at every viewport the program
 * ships against.
 */

import { test, expect } from "@playwright/test";
import {
  installHermeticNetworkFence,
  startHermeticApp,
} from "../e2e-fixtures/hermetic-harness.mjs";
import {
  BEAT_IDS,
  bootColdStart,
  DESKTOP,
  goToBeat,
  labelGeometry,
  openFlow,
  PHONE,
  SHELL,
} from "./visual-gate-helpers.mjs";

/** Every button rendered inside a beat's content, chassis chrome excluded. */
const BEAT_BUTTONS = `${SHELL} .discovery-setup-wizard__step-content button`;

let app = null;

test.beforeAll(async () => {
  app = await startHermeticApp();
});

test.afterAll(async () => {
  if (app) await app.close();
});

for (const viewport of [DESKTOP, PHONE]) {
  const label = `${viewport.width}×${viewport.height}`;

  test.describe(`inline beat actions at ${label}`, () => {
    test.use({ viewport });

    test(`should never break a control's own label across lines (${label})`, async ({
      page,
    }) => {
      // Asserted on every beat, not just beat 4: the wrap is a property of
      // the chassis rule plus a flex row, and both are shared. A label with
      // no whitespace in it has no legitimate break opportunity, so more
      // than one line box IS the "Ad / d" defect.
      const fence = await installHermeticNetworkFence(page, {
        baseUrl: app.baseUrl,
      });
      await bootColdStart(page, app.baseUrl);
      await openFlow(page);

      let inspected = 0;
      for (const beat of BEAT_IDS) {
        await goToBeat(page, beat);
        const buttons = await labelGeometry(page, BEAT_BUTTONS);
        for (const button of buttons) {
          if (!button.text || /\s/.test(button.text)) continue;
          inspected += 1;
          expect(
            button.lines,
            `beat "${beat}": "${button.text}" wrapped onto ${button.lines} lines (${JSON.stringify(button.lineWidths)}) — ${JSON.stringify(button)}`,
          ).toBe(1);
          if (button.lineHeight) {
            expect(
              button.height,
              `beat "${beat}": "${button.text}" is ${button.height}px tall, taller than one ${button.lineHeight}px line — ${JSON.stringify(button)}`,
            ).toBeLessThan(button.lineHeight * 2);
          }
        }
      }

      expect(
        inspected,
        "the walk must actually reach some single-word controls",
      ).toBeGreaterThan(0);
      expect(fence.unexpectedExternal).toEqual([]);
    });

    test(`should keep beat 4's Add controls at their natural width beside the inputs (${label})`, async ({
      page,
    }) => {
      // The specific surface the orchestrator flagged. Beyond "one line",
      // the button has to be wide enough to READ: a control squeezed to
      // 24px with its text clipped is the same failure wearing a different
      // computed style.
      const fence = await installHermeticNetworkFence(page, {
        baseUrl: app.baseUrl,
      });
      await bootColdStart(page, app.baseUrl);
      await openFlow(page);
      await goToBeat(page, "fit");

      const adds = (
        await labelGeometry(page, `${SHELL} .oneflow-fit-link-button`)
      ).filter((button) => button.text === "Add");
      expect(
        adds.length,
        "beat 4 offers an Add beside roles, strengths, and each lean list",
      ).toBeGreaterThanOrEqual(2);

      for (const add of adds) {
        expect(add.lines, `"Add" wrapped: ${JSON.stringify(add)}`).toBe(1);
        expect(
          add.width,
          `"Add" is squeezed narrower than its own label: ${JSON.stringify(add)}`,
        ).toBeGreaterThanOrEqual(add.lineWidths[0]);
        expect(
          add.flexShrink,
          "an inline action beside a full-width input must not shrink",
        ).toBe("0");
      }

      // The row it lives in still fits: fixing the shrink must not push the
      // input off the card.
      const row = await page.evaluate(() => {
        const node = globalThis.document.querySelector(
          ".discovery-setup-wizard--spine .oneflow-fit-chips__add",
        );
        return { scrollWidth: node.scrollWidth, clientWidth: node.clientWidth };
      });
      expect(
        row.scrollWidth,
        `the add row overflows its card: ${JSON.stringify(row)}`,
      ).toBeLessThanOrEqual(row.clientWidth + 1);

      expect(fence.unexpectedExternal).toEqual([]);
    });
  });
}
