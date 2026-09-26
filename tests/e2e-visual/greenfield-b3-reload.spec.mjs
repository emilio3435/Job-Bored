/**
 * greenfield-b3-reload.spec.mjs — the real-browser proof for GREENFIELD F2.
 *
 * The greenfield walkthrough pasted a resume into Beat 3, hit Escape, and
 * reloaded. The textarea came back empty. Every node probe for draft
 * persistence was green at the time, because they all drove `ctx.saveDraft`
 * directly and then awaited it — which is the one thing a person leaving the
 * page does not do.
 *
 * So this spec never calls saveDraft. It puts text in the box the way a
 * person does, leaves the way a person does, and reloads. Twice: once with
 * `locator.type()` (keystrokes, `input` per character) and once with
 * `locator.fill()` (a programmatic value set, `input` + `change` and no
 * keystrokes at all) — the two paths spec §4.2 makes the mirror cover.
 *
 * Claim B4. The invariant under test is §4.2's: the localStorage mirror is
 * written synchronously, so no unload window can lose the text.
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
  settleLayout,
} from "./visual-gate-helpers.mjs";

const PASTE = "#oneFlowResumePaste";
const PAUSE_TOAST = "Setup paused — pick up right here anytime.";
const MIRROR_KEY = "jb_oneflow_draft_resumeText";
const RESUME_PRIMARY = "Resume setup — Resume";

/** 400+ chars, the length the walkthrough actually lost. */
const RESUME_TEXT = [
  "Emilio Nunez Garcia — Staff Software Engineer — Austin, TX",
  "Founder of Elio AI. Twelve years building reliable distributed systems,",
  "developer platforms, and the boring infrastructure other teams build their",
  "careers on top of. Led the migration of a 400-service fleet onto a single",
  "deployment substrate, cut median deploy time from 40 minutes to 4, and kept",
  "the error budget green through the whole cutover.",
  "Looking for: staff or principal platform work, remote-first, US authorized.",
  "Avoid: adtech, crypto, anything on-call for someone else's outage.",
].join("\n");

let app = null;

test.beforeAll(async () => {
  app = await startHermeticApp();
});

test.afterAll(async () => {
  if (app) await app.close();
});

/**
 * Land on Beat 3 by finishing Beat 2, which is what the flow itself does —
 * and which leaves `ai` in completedBeats, the prerequisite Beat 3 carries.
 *
 * Beat 1 is deliberately NOT completed: its exit condition is a configured
 * sheet, and the hermetic greenfield boot has none, so a faked completion
 * there is reconciled away on the next entry (`reconcileStaleCompletion`)
 * and the reload would land on Beat 1 for a reason that has nothing to do
 * with drafts. Drafts survive that reconcile either way — it clears
 * progress, never the scratch.
 */
async function reachResumeBeat(page) {
  await page.evaluate(async () => {
    await globalThis.JobBoredOneFlow.completeBeat("ai");
  });
  await page.waitForFunction(
    () =>
      globalThis.document.querySelector("#oneFlowMount .oneflow-beat")?.dataset
        .beatId === "resume",
  );
  await settleLayout(page);
}

/** Which beat the shell is showing right now, or "" when it is closed. */
function openBeatId(page) {
  return page.evaluate(
    (sel) =>
      globalThis.document.querySelector(`${sel} .oneflow-beat`)?.dataset
        .beatId || "",
    FLOW_MOUNT,
  );
}

for (const entry of [
  {
    label: "typed with locator.type()",
    async put(page) {
      await page.locator(PASTE).type(RESUME_TEXT);
    },
  },
  {
    label: "set programmatically with locator.fill()",
    async put(page) {
      await page.locator(PASTE).fill(RESUME_TEXT);
    },
  },
]) {
  test.describe(`a Beat 3 resume ${entry.label}`, () => {
    test.use({ viewport: DESKTOP });

    test(`should survive Escape and a reload (${entry.label})`, async ({
      page,
    }) => {
      await installHermeticNetworkFence(page, { baseUrl: app.baseUrl });
      await bootColdStart(page, app.baseUrl);
      await openFlow(page);
      await reachResumeBeat(page);

      await entry.put(page);
      expect(
        (await page.locator(PASTE).inputValue()).length,
        "the probe has to lose something worth losing",
      ).toBeGreaterThan(400);

      // The mirror is the whole mechanism: it must be on disk BEFORE the
      // page is asked to go anywhere.
      const mirrored = await page.evaluate(
        (key) => globalThis.localStorage.getItem(key),
        MIRROR_KEY,
      );
      expect(mirrored, `${MIRROR_KEY} must hold the text before anything else`)
        .not.toBeNull();
      expect(JSON.parse(mirrored).text).toBe(RESUME_TEXT);

      await page.keyboard.press("Escape");
      await expect(
        page.locator("#toastContainer .toast-message", {
          hasText: PAUSE_TOAST,
        }),
      ).toBeVisible();

      await page.reload({ waitUntil: "load" });
      await page.waitForSelector(".oneflow-demo__invite");
      await settleLayout(page);
      await openFlow(page, RESUME_PRIMARY);

      expect(await openBeatId(page), "reopening lands on the saved beat").toBe(
        "resume",
      );
      await expect(page.locator(PASTE)).toHaveValue(RESUME_TEXT);
    });
  });
}

test.describe("the Beat 3 resume under prefers-reduced-motion", () => {
  test.use({ viewport: DESKTOP });

  test("should survive Escape and a reload with motion suppressed", async ({
    page,
  }) => {
    // Emulated on the page, not via a describe-level `test.use({reducedMotion})`
    // — that option never reaches the document, so the assertion below is what
    // proves the browser is actually in the state this test claims to cover.
    await page.emulateMedia({ reducedMotion: "reduce" });
    await installHermeticNetworkFence(page, { baseUrl: app.baseUrl });
    await bootColdStart(page, app.baseUrl);
    expect(
      await page.evaluate(
        () => globalThis.matchMedia("(prefers-reduced-motion: reduce)").matches,
      ),
      "the browser really is in reduced motion",
    ).toBe(true);

    await openFlow(page);
    await reachResumeBeat(page);
    await page.locator(PASTE).fill(RESUME_TEXT);
    await page.keyboard.press("Escape");
    await expect(
      page.locator("#toastContainer .toast-message", { hasText: PAUSE_TOAST }),
    ).toBeVisible();

    await page.reload({ waitUntil: "load" });
    await page.waitForSelector(".oneflow-demo__invite");
    await openFlow(page, RESUME_PRIMARY);
    expect(await openBeatId(page)).toBe("resume");
    await expect(page.locator(PASTE)).toHaveValue(RESUME_TEXT);
  });
});

test.describe("the mirror's clearing rule", () => {
  test.use({ viewport: DESKTOP });

  test("should be cleared by the flow's reset path and by nothing else", async ({
    page,
  }) => {
    await installHermeticNetworkFence(page, { baseUrl: app.baseUrl });
    await bootColdStart(page, app.baseUrl);
    await openFlow(page);
    await reachResumeBeat(page);
    await page.locator(PASTE).fill(RESUME_TEXT);

    // Moving on through the flow must not touch it: a stale mirror is
    // harmless because hydrate only ever fills an EMPTY textarea.
    await page.evaluate(() =>
      globalThis.JobBoredOneFlow.goToBeat("fit"),
    );
    await page.waitForFunction(
      (sel) =>
        globalThis.document.querySelector(`${sel} .oneflow-beat`)?.dataset
          .beatId === "fit",
      FLOW_MOUNT,
    );
    expect(
      await page.evaluate(
        (key) => globalThis.localStorage.getItem(key),
        MIRROR_KEY,
      ),
      "a beat transition is not a reset",
    ).not.toBeNull();

    await page.evaluate(() =>
      globalThis.CommandCenterUserContent.clearOnboardingFlowState(),
    );
    expect(
      await page.evaluate(
        (key) => globalThis.localStorage.getItem(key),
        MIRROR_KEY,
      ),
      "clearOnboardingFlowState is the single reset path (§4.2)",
    ).toBeNull();
  });
});
