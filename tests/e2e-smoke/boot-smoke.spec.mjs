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
 * the same first-boot a brand-new clone sees.
 *
 * Run:
 *   npm run test:e2e-smoke
 */

import { test, expect } from "@playwright/test";
import { copyFileSync, existsSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { startDevServer } from "../../dev-server.mjs";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..");
const CONFIG_PATH = join(REPO_ROOT, "config.js");
const CONFIG_EXAMPLE_PATH = join(REPO_ROOT, "config.example.js");

// The dashboard polls the optional local materials API (server/index.mjs,
// default 127.0.0.1:3847) at boot. Tests must never depend on — or touch —
// another local process, so those calls are answered in-page with empty
// catalogs. This is environment isolation, not a console-error allowlist:
// every error raised by the app's own code still fails the boot assertion.
const MATERIALS_API_GLOBS = [
  "**://127.0.0.1:3847/**",
  "**://localhost:3847/**",
];

const quietLogger = { log() {}, warn() {}, error() {} };

let server = null;
let baseUrl = "";
let createdConfigJs = false;

test.beforeAll(async () => {
  // index.html loads config.js, which is gitignored (npm run setup creates
  // it from the example). Provision it for fresh checkouts/CI; never clobber
  // a developer's real config.js, and clean up only what we created.
  if (!existsSync(CONFIG_PATH)) {
    copyFileSync(CONFIG_EXAMPLE_PATH, CONFIG_PATH);
    createdConfigJs = true;
  }
  server = await startDevServer({ port: 0, logger: quietLogger });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.afterAll(async () => {
  if (server) await new Promise((done) => server.close(done));
  if (createdConfigJs) rmSync(CONFIG_PATH, { force: true });
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
  for (const glob of MATERIALS_API_GLOBS) {
    await page.route(glob, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "access-control-allow-origin": "*" },
        body: JSON.stringify({ ok: true, applications: [], queue: [] }),
      }),
    );
  }
  await page.goto(`${baseUrl}/?greenfield=1`, { waitUntil: "load" });
  await expect(page.locator("#sheetAccessGateScreen")).toBeVisible({
    timeout: 15_000,
  });
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
  const res = await fetch(`${baseUrl}/`);
  expect(res.status).toBe(200);
  // Strip HTML comments first — the browser never requests commented-out
  // script tags, so neither should this check.
  const html = (await res.text()).replace(/<!--[\s\S]*?-->/g, "");
  const srcs = [...html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)].map((m) =>
    new URL(m[1], `${baseUrl}/`).toString(),
  );
  expect(srcs.length, "served HTML should reference scripts").toBeGreaterThan(0);

  // Judge each script by the response the browser itself received while
  // booting — the same network stack real users hit, and it covers external
  // scripts (e.g. the GSI client) without a separate Node-side fetch.
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
