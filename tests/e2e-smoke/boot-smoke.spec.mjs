/**
 * boot-smoke.spec.mjs — Playwright boot-and-visibility smoke suite.
 *
 * Catches the bug class unit tests cannot: CSS cascades hiding interactive
 * elements, z-index burial, missing <script> wiring, and boot-time console
 * errors. Boot-and-visibility only — nothing here talks to the discovery
 * worker, writes env files, or kills ports.
 *
 * The suite spawns the real dev server (dev-server.mjs) in-process on a
 * random port and loads the dashboard in greenfield mode (?greenfield=1),
 * the same first-boot a brand-new clone sees. Google, Sheets, fonts, and
 * config.js are served from tests/e2e-fixtures/hermetic-harness.mjs so the
 * checkout's config.js and live Google are never touched.
 *
 * The surface under test is the one-flow's, not the credential-first
 * onboarding it replaced: ONE-FLOW-ONBOARDING-SPEC §4 makes screen S0 —
 * the demo board — the cold-start screen, and §3.5 puts every beat in one
 * shell at #oneFlowMount.
 *
 * Run:
 *   npm run test:e2e-smoke
 */

import { test, expect } from "@playwright/test";
import {
  installHermeticNetworkFence,
  startHermeticApp,
} from "../e2e-fixtures/hermetic-harness.mjs";

/** Screen S0's overlay root (oneflow-demo-board.js ROOT_ID). */
const DEMO_BOARD = "#oneFlowDemoBoard";
/** The single shell mount every beat renders into (spec §3.5). */
const FLOW_MOUNT = "#oneFlowMount";

let app = null;

test.beforeAll(async () => {
  app = await startHermeticApp();
});

test.afterAll(async () => {
  if (app) await app.close();
});

/**
 * Navigate to the greenfield dashboard and wait for boot to finish. Boot is
 * finished when screen S0 has painted: since the one-flow cutover the demo
 * board — not a credential gate — is what a zero-config visitor gets
 * (spec §4, "give before you ask"). Returns the list of console errors and
 * uncaught page errors collected since navigation started.
 */
async function bootGreenfield(page) {
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => {
    consoleErrors.push(`pageerror: ${err.message}`);
  });
  const fence = await installHermeticNetworkFence(page, { baseUrl: app.baseUrl });
  await page.goto(`${app.baseUrl}/?greenfield=1`, { waitUntil: "load" });
  await expect(page.locator(DEMO_BOARD)).toBeVisible({
    timeout: 15_000,
  });
  expect(
    fence.unexpectedExternal,
    "greenfield boot must not escape the hermetic network fence",
  ).toEqual([]);
  return consoleErrors;
}

/** Computed-style snapshot — what the user's browser actually resolved. */
function computedVisibility(locator) {
  return locator.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { display: cs.display, visibility: cs.visibility };
  });
}

/**
 * A button the user can actually hit: visible to Playwright (which covers
 * ancestor hiding) AND laid out with a non-zero box (which covers the
 * collapsed-flex and zero-height cases toBeVisible alone would pass).
 */
async function expectClickableBox(locator, label) {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  expect(box, `${label} should have a bounding box`).not.toBeNull();
  expect(box.width).toBeGreaterThan(0);
  expect(box.height).toBeGreaterThan(0);
}

test("greenfield boot produces zero console errors", async ({ page }) => {
  const consoleErrors = await bootGreenfield(page);
  // Boot continues after S0 paints (auth bootstrap, readiness checks, and
  // the index.html blank-shell watchdog at DOMContentLoaded + 2s); give the
  // async tail a beat before judging the console.
  await page.waitForTimeout(3_000);
  expect(consoleErrors, "boot must be console-error free (no allowlist)").toEqual([]);
});

test("every <script src> in the served HTML returns 200", async ({ page }) => {
  const res = await fetch(`${app.baseUrl}/`);
  expect(res.status).toBe(200);
  // Strip HTML comments first — the browser never requests commented-out
  // script tags, so neither should this check.
  const html = (await res.text()).replace(/<!--[\s\S]*?-->/g, "");
  const srcs = [...html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)].map((m) =>
    new URL(m[1], `${app.baseUrl}/`).toString(),
  );
  expect(srcs.length, "served HTML should reference scripts").toBeGreaterThan(0);

  // Judge each script by the response the browser itself received while
  // booting — the same network stack real users hit. External scripts
  // (GSI) are fulfilled by the hermetic fence, not the live Google host.
  const responseStatus = new Map();
  page.on("response", (response) => {
    responseStatus.set(response.url(), response.status());
  });
  await bootGreenfield(page);

  const failures = srcs
    .filter((url) => responseStatus.get(url) !== 200)
    .map((url) => `${responseStatus.get(url) ?? "no response"} ${url}`);
  expect(failures, "every <script src> must load with 200").toEqual([]);
});

test("screen S0 — the demo board — is the cold-start surface, credential gate hidden", async ({
  page,
}) => {
  // spec §4: a cold start opens on scored demo cards, not a credential ask.
  // The gate object still exists for its error mode; what must not happen is
  // it rendering over a merely-empty config the way the old opening did.
  await bootGreenfield(page);
  const board = page.locator(DEMO_BOARD);
  const computed = await computedVisibility(board);
  expect(computed.display).not.toBe("none");
  expect(computed.visibility).toBe("visible");

  await expect(page.locator("#sheetAccessGateScreen")).toBeHidden();
  await expect(page.locator(FLOW_MOUNT)).toBeHidden();
});

test("demo cards render watermarked, with a fit score and a why-it-fits line", async ({
  page,
}) => {
  // spec §4 content contract: the fixture board is the product, so an empty
  // board (fixture 404, JSON drift, renderer regression) is a boot failure —
  // the invitation card alone is not screen S0.
  await bootGreenfield(page);
  const cards = page.locator(`${DEMO_BOARD} .oneflow-demo__card`);
  await expect(cards.first()).toBeVisible();
  expect(await cards.count()).toBeGreaterThan(0);

  const first = cards.first();
  await expect(first.locator(".oneflow-demo__chip")).toHaveText("DEMO");
  await expect(first.locator(".oneflow-demo__score")).toContainText("fit");
  await expect(first.locator(".oneflow-demo__why")).not.toBeEmpty();
});

test("JobBoredOneFlow.open() renders a beat, and its primary action is hittable", async ({
  page,
}) => {
  // The first-run wizard this used to open is deleted (§7). Same bug class,
  // new surface: toBeVisible covers ancestor hiding and zero-size boxes, and
  // the computed-style check is what catches the CSS-cascade case where JS
  // "shows" the beat but a stylesheet wins and keeps it display:none.
  await bootGreenfield(page);
  await page.evaluate(() => window.JobBoredOneFlow.open("google"));
  const beat = page.locator(`${FLOW_MOUNT} .oneflow-beat`);
  await expect(beat).toBeVisible();
  const computed = await computedVisibility(beat);
  expect(computed.display).not.toBe("none");
  expect(computed.visibility).toBe("visible");

  await expectClickableBox(
    page.locator(`${FLOW_MOUNT} .discovery-setup-wizard__btn--primary`).first(),
    "the beat's primary action",
  );
});

test("requestDiscoverySetup() renders the wizard shell with a usable primary action", async ({ page }) => {
  // The discovery setup wizard survives the cutover as B5's connect panel
  // and as the Settings surface; §5 B5 removed its onboarding bypass, so
  // an onboarding-entry request must open now rather than defer.
  await bootGreenfield(page);
  const result = await page.evaluate(() =>
    window.JobBoredApp.core.host.requestDiscoverySetup({
      entryPoint: "onboarding",
      allowWhileOnboarding: true,
    }),
  );
  expect(result, "setup request must open now, not defer").toEqual({
    deferred: false,
  });
  const mount = "#discoverySetupWizardMount";
  await expect(page.locator(`${mount} .discovery-setup-wizard`)).toBeVisible();
  await expectClickableBox(
    page.locator(`${mount} .discovery-setup-wizard__btn--primary`).first(),
    "the discovery wizard's primary action",
  );
});
