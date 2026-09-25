/**
 * UX01 lane F — States (C21) and Settings (C22), in a real browser.
 *
 * Hermetic: every Google / Sheets call is answered by the C1 fence in
 * tests/e2e-fixtures/hermetic-harness.mjs. Nothing here clicks a save,
 * verify, start, install, fix, or test-connection action.
 */
import { test, expect } from "@playwright/test";
import {
  DISPOSABLE_AUTH,
  installHermeticNetworkFence,
  startHermeticApp,
  stageSignedInDisposableAuth,
} from "../e2e-fixtures/hermetic-harness.mjs";

let app = null;

test.beforeAll(async () => {
  app = await startHermeticApp();
});

test.afterAll(async () => {
  if (app) await app.close();
});

async function bootSignedIn(page) {
  const fence = await installHermeticNetworkFence(page, {
    baseUrl: app.baseUrl,
    pipelineStartsWithJob: true,
  });
  await stageSignedInDisposableAuth(page, DISPOSABLE_AUTH);
  await page.goto(`${app.baseUrl}/?jb-v2=1`, { waitUntil: "load" });
  await page.evaluate(async () => {
    await globalThis.CommandCenterUserContent.completeInfraSetup();
    await globalThis.CommandCenterUserContent.completeOnboarding();
  });
  await page.reload({ waitUntil: "load" });
  await expect(page.locator("#dashboard")).toBeVisible();
  return fence;
}

test("C21: a refresh that gets 403 keeps the board and offers Retry", async ({ page }) => {
  await bootSignedIn(page);
  await expect(page.locator("#jbSyncBar")).toBeVisible();
  await expect(page.locator("#jbSyncLabel")).toHaveText(/Synced/);
  const role = page.getByText("Platform Engineer").first();
  await expect(role).toBeVisible();

  await page.evaluate(() => {
    globalThis.__jbEvents = [];
    for (const t of ["jb:data:loaded", "jb:data:load-failed"]) {
      globalThis.addEventListener(t, (e) => globalThis.__jbEvents.push({ t, detail: e.detail && { status: e.detail.status, lastSyncedAt: e.detail.lastSyncedAt } }));
    }
  });

  // Access lost mid-session: Sheets answers 403 and the public fallbacks fail.
  const forbid = async (route) => {
    await route.fulfill({
      status: 403,
      contentType: "application/json",
      body: JSON.stringify({ error: { message: "The caller does not have permission" } }),
    });
  };
  await page.route("https://sheets.googleapis.com/**", forbid);
  await page.route("https://docs.google.com/**", (route) => route.fulfill({ status: 404, body: "" }));

  const ok = await page.evaluate(() => globalThis.JobBoredApp.sheetsRead.loadAllData());
  expect(ok).toBe(false);

  const banner = page.locator("#jbSyncBanner");
  await expect(banner).toBeVisible();
  await expect(banner).toContainText(`${DISPOSABLE_AUTH.userEmail} can’t open this Sheet`);
  await expect(banner).not.toContainText("caller");
  // The board did not go empty.
  await expect(role).toBeVisible();
  const events = await page.evaluate(() => globalThis.__jbEvents);
  const failed = events.find((e) => e.t === "jb:data:load-failed");
  expect(failed && failed.detail.status).toBe(403);
  expect(failed && failed.detail.lastSyncedAt).toBeGreaterThan(0);

  // Access comes back: Retry clears the banner.
  await page.unroute("https://sheets.googleapis.com/**", forbid);
  await banner.getByRole("button", { name: "Retry" }).click();
  await expect(banner).toBeHidden();
  await expect(role).toBeVisible();
});

test("C22: every Settings tab is reachable at 375 px", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await bootSignedIn(page);
  await page.evaluate(() => globalThis.openCommandCenterSettingsModal());
  const modal = page.locator("#settingsModal");
  await expect(modal).toBeVisible();
  const tabs = modal.getByRole("tab");
  const n = await tabs.count();
  expect(n).toBeGreaterThanOrEqual(7);
  for (let i = 0; i < n; i += 1) {
    const tab = tabs.nth(i);
    await expect(tab).toBeVisible();
    const box = await tab.boundingBox();
    expect(box, `tab ${i} has a box`).not.toBeNull();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(375);
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
  // The last tab can be clicked (not hidden off-screen) and has no footer Save.
  await tabs.nth(n - 1).click();
  await expect(modal.locator("#settings-panel-upgrades")).toBeVisible();
  await expect(modal.locator("#settingsSaveBtn")).toBeHidden();
});

test("C22: Scraper setup opened from Settings is on top and usable", async ({ page }) => {
  await bootSignedIn(page);
  await page.evaluate(() => globalThis.openCommandCenterSettingsModal({ tab: "scraping" }));
  await page.locator("#openScraperSetupFromSettings").click();
  const scraper = page.locator("#scraperSetupModal");
  await expect(scraper).toBeVisible();
  const done = page.locator("#scraperSetupDoneBtn");
  const hit = await done.evaluate((btn) => {
    const r = btn.getBoundingClientRect();
    const el = globalThis.document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return { onTop: !!el && btn.contains(el), inert: globalThis.document.getElementById("scraperSetupModal").inert };
  });
  expect(hit.inert).toBe(false);
  expect(hit.onTop).toBe(true);
  await page.keyboard.press("Escape");
  await expect(scraper).toBeHidden();
  // Escape closed the guide only, not Settings behind it.
  await expect(page.locator("#settingsModal")).toBeVisible();
});

test("C22: closing Settings with unsaved edits asks first", async ({ page }) => {
  await bootSignedIn(page);
  await page.evaluate(() => globalThis.openCommandCenterSettingsModal({ tab: "setup" }));
  const modal = page.locator("#settingsModal");
  await expect(modal).toBeVisible();
  const field = modal.locator('input[id^="settings"]:visible').first();
  await field.fill("an unsaved edit");
  let asked = "";
  page.once("dialog", async (d) => {
    asked = d.message();
    await d.dismiss();
  });
  await page.keyboard.press("Escape");
  await expect.poll(() => asked).toMatch(/Discard/);
  await expect(modal).toBeVisible();
});

test("C21: a silent sign-in restore that never answers opens the sign-in gate", async ({ page }) => {
  await installHermeticNetworkFence(page, { baseUrl: app.baseUrl, pipelineStartsWithJob: true });
  // Metadata survives but the runtime token is gone: boot must silently
  // restore. The hermetic GIS stub never answers prompt:"none".
  await page.addInitScript(({ clientId, sheetId, userEmail }) => {
    globalThis.localStorage.setItem(
      "command_center_config_overrides",
      JSON.stringify({ sheetId, oauthClientId: clientId }),
    );
    globalThis.localStorage.setItem(
      "command_center_oauth_session",
      JSON.stringify({
        expiresAt: Date.now() - 60 * 60 * 1000,
        userEmail,
        grantedOauthScopes: "https://www.googleapis.com/auth/spreadsheets",
        oauthClientId: clientId,
        hasOauthSession: true,
      }),
    );
    globalThis.localStorage.setItem("command_center_discovery_coach_done", "1");
  }, {
    clientId: DISPOSABLE_AUTH.oauthClientId,
    sheetId: DISPOSABLE_AUTH.sheetId,
    userEmail: DISPOSABLE_AUTH.userEmail,
  });
  await page.goto(`${app.baseUrl}/?jb-v2=1`, { waitUntil: "load" });
  const gate = page.locator("#sheetAccessGateScreen");
  await expect(gate).toBeVisible({ timeout: 15_000 });
  await expect(page.locator("#sheetAccessGateTitle")).toHaveText("Your Google session ended", { timeout: 15_000 });
  await expect(page.locator("#sheetAccessGateSignInBtn")).toBeVisible();
});
