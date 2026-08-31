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
 * Run:
 *   npm run test:e2e-smoke
 */

import { test, expect } from "@playwright/test";
import {
  installHermeticNetworkFence,
  startHermeticApp,
} from "../e2e-fixtures/hermetic-harness.mjs";

let app = null;

test.beforeAll(async () => {
  app = await startHermeticApp();
});

test.afterAll(async () => {
  if (app) await app.close();
});

/**
 * Navigate to the greenfield dashboard and wait for boot to finish (the
 * login gate owns the first-boot surface). Returns the list of console
 * errors and uncaught page errors collected since navigation started.
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
  await expect(page.locator("#sheetAccessGateScreen")).toBeVisible({
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

async function expectVisiblePrimaryAction(page, mountSelector) {
  const shell = page.locator(`${mountSelector} .discovery-setup-wizard`);
  await expect(shell).toBeVisible();
  const primary = page
    .locator(`${mountSelector} .discovery-setup-wizard__btn--primary`)
    .first();
  await expect(primary).toBeVisible();
  const box = await primary.boundingBox();
  expect(box, "primary action button should have a bounding box").not.toBeNull();
  expect(box.width).toBeGreaterThan(0);
  expect(box.height).toBeGreaterThan(0);
}

test("greenfield boot produces zero console errors", async ({ page }) => {
  const consoleErrors = await bootGreenfield(page);
  // Boot continues after the gate appears (auth bootstrap, readiness
  // checks); give the async tail a beat before judging the console.
  await page.waitForTimeout(2_000);
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

test("the login gate is visible on greenfield boot", async ({ page }) => {
  await bootGreenfield(page);
  const gate = page.locator("#sheetAccessGateScreen");
  await expect(gate).toBeVisible();
  const computed = await computedVisibility(gate);
  expect(computed.display).not.toBe("none");
  expect(computed.visibility).toBe("visible");
});

test("reopenFirstRunWizard() makes #firstRunWizard visible by computed style", async ({ page }) => {
  await bootGreenfield(page);
  await page.evaluate(() => {
    window.JobBoredApp.firstRunWizard.reopenFirstRunWizard();
  });
  const wizard = page.locator("#firstRunWizard");
  // toBeVisible covers ancestor hiding and zero-size boxes; the computed
  // style check is what catches the [hidden]-attribute/CSS-cascade bug
  // class, where JS "shows" the wizard but a stylesheet wins the cascade
  // and keeps it display:none.
  await expect(wizard).toBeVisible();
  const computed = await computedVisibility(wizard);
  expect(computed.display).not.toBe("none");
  expect(computed.visibility).toBe("visible");
});

test("requestDiscoverySetup() renders the wizard shell with a usable primary action", async ({ page }) => {
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
  await expectVisiblePrimaryAction(page, "#discoverySetupWizardMount");
});

test("openEnhancementsWizard() renders the wizard shell with a usable primary action", async ({ page }) => {
  await bootGreenfield(page);
  await page.evaluate(() =>
    window.JobBoredEnhancements.openEnhancementsWizard({ entryPoint: "qa" }),
  );
  await expectVisiblePrimaryAction(page, "#enhancementsWizardMount");
});
