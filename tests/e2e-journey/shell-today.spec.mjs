/* global document, window, matchMedia, getComputedStyle -- evaluated in the browser page */
/**
 * UX01 lane C — the shell and Today, in a real browser.
 *
 *   C18  Today, Pipeline and Dossier are views on the same anchors: one
 *        visible at a time, focus moves to the view you pick, a skip link
 *        is the first Tab stop, the dossier takes focus and gives it back,
 *        and the bar fits a 375 px phone.
 *   C5   "Add job" sits in the top bar, and an empty pipeline shows the
 *        three ways in with real buttons.
 *   C20  Today's rows carry the action that clears them, and each write
 *        reaches the Sheet exactly once.
 *
 * Hermetic: the harness fence answers Google, Sheets and every host path.
 * The Sheet GET is overridden per test with fictional rows.
 */

import { test, expect } from "@playwright/test";
import {
  DISPOSABLE_AUTH,
  PIPELINE_HEADERS,
  installHermeticNetworkFence,
  stageSignedInDisposableAuth,
  startHermeticApp,
} from "../e2e-fixtures/hermetic-harness.mjs";

let app;

test.beforeAll(async () => {
  app = await startHermeticApp();
});

test.afterAll(async () => {
  await app?.close();
});

function localIso(offsetDays) {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + offsetDays);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/** One Sheet row in PIPELINE_HEADERS order, from a small field bag. */
function row(fields) {
  const byHeader = {
    "Date Found": fields.found || localIso(-3),
    Title: fields.title,
    Company: fields.company,
    Location: fields.location || "Remote",
    Link: fields.link || `https://jobs.example.test/${fields.company.toLowerCase()}`,
    Source: "Fixture",
    "Fit Score": fields.fit == null ? "" : String(fields.fit),
    Status: fields.status || "New",
    "Applied Date": fields.applied || "",
    "Follow-up Date": fields.followUp || "",
    "Last contact": fields.lastContact || "",
    "Did they reply?": fields.replied || "",
  };
  return PIPELINE_HEADERS.map((h) => byHeader[h] ?? "");
}

const ROWS = [
  row({ title: "Product Engineer", company: "Juniper", status: "Applied",
    applied: localIso(-9), followUp: localIso(-2) }),
  row({ title: "Frontend Engineer", company: "Tidewater", status: "Phone Screen",
    replied: "Yes", lastContact: localIso(-3) }),
  row({ title: "Platform Engineer", company: "Lumen", status: "New", fit: 9 }),
];

/**
 * Serve `rows` for every Sheet GET and record every Sheet write. Registered
 * after the fence, so it takes precedence for sheets.googleapis.com only.
 */
async function serveSheet(page, rows) {
  const writes = [];
  await page.route("https://sheets.googleapis.com/**", async (route) => {
    const req = route.request();
    if (req.method() !== "GET") {
      writes.push({ method: req.method(), url: decodeURIComponent(req.url()) });
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "access-control-allow-origin": "*" },
        body: JSON.stringify({ updatedCells: 1 }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify({
        range: "Pipeline!A:ZZ",
        majorDimension: "ROWS",
        values: [PIPELINE_HEADERS, ...rows],
      }),
    });
  });
  return writes;
}

async function bootSignedIn(page, rows = ROWS) {
  const fence = await installHermeticNetworkFence(page, { baseUrl: app.baseUrl });
  const writes = await serveSheet(page, rows);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await stageSignedInDisposableAuth(page, DISPOSABLE_AUTH);
  await page.goto(`${app.baseUrl}/?jb-v2=1`, { waitUntil: "load" });
  await page.evaluate(async () => {
    await globalThis.CommandCenterUserContent.completeInfraSetup();
    await globalThis.CommandCenterUserContent.completeOnboarding();
  });
  await page.reload({ waitUntil: "load" });
  await expect(page.locator("#dashboard")).toBeVisible();
  expect(await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(true);
  return { fence, writes };
}

const TODAY = '[data-region="today"]';
const PIPELINE = '[data-region="pipeline"]';
const ROLE = '[data-region="role"]';

test("should open on Today and show one view at a time, moving focus to the view picked", async ({ page }) => {
  const { fence } = await bootSignedIn(page);

  await expect(page.locator(TODAY)).toBeVisible();
  await expect(page.locator(PIPELINE)).toBeHidden();
  await expect(page.locator(ROLE)).toBeHidden();

  const nav = page.getByRole("navigation", { name: "Views" });
  await expect(nav.getByRole("button", { name: /Today/ })).toHaveAttribute("aria-current", "page");

  await nav.getByRole("button", { name: /Pipeline/ }).click();
  await expect(page.locator(PIPELINE)).toBeVisible();
  await expect(page.locator(TODAY)).toBeHidden();
  await expect(nav.getByRole("button", { name: /Pipeline/ })).toHaveAttribute("aria-current", "page");
  expect(await page.evaluate(() => !!document.activeElement.closest('[data-region="pipeline"]'))).toBe(true);

  /* AX-23: no build tag in any landmark name. */
  const labels = await page.$$eval("[data-region][aria-label]", (els) => els.map((e) => e.getAttribute("aria-label")));
  expect(labels.filter((l) => /\(v2\)/.test(l))).toEqual([]);
  expect(fence.unexpectedExternal).toEqual([]);
});

test("should make Skip to Pipeline the first Tab stop", async ({ page }) => {
  await bootSignedIn(page);
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await page.keyboard.press("Tab");
  const focused = page.locator(":focus");
  await expect(focused).toHaveText("Skip to Pipeline");
  await page.keyboard.press("Enter");
  await expect(page.locator(PIPELINE)).toBeVisible();
  await expect(page.locator(TODAY)).toBeHidden();
});

test("should open the dossier as a view, focus its heading, and hand focus back on close", async ({ page }) => {
  await bootSignedIn(page);
  await page.getByRole("navigation", { name: "Views" }).getByRole("button", { name: /Pipeline/ }).click();

  /* The board may start with the Discovered column collapsed (C19 is lane
     D's); open it the way a user would when it is. */
  const expand = page.getByRole("button", { name: "Expand Discovered" });
  if (await expand.count()) await expand.click();
  const card = page.locator('.pipe-sticker[data-stable-key="2"]');
  await expect(card).toBeVisible();
  await card.click();

  await expect(page.locator(ROLE)).toBeVisible();
  await expect(page.locator(PIPELINE)).toBeHidden();
  await expect.poll(() => page.evaluate(() => document.activeElement.className)).toContain("case__title-h");

  await page.locator(ROLE).getByRole("button", { name: "Close this role" }).click();
  await expect(page.locator(PIPELINE)).toBeVisible();
  await expect(page.locator(ROLE)).toBeHidden();
  await expect
    .poll(() => page.evaluate(() => {
      const sticker = document.activeElement.closest(".pipe-sticker");
      return sticker ? sticker.getAttribute("data-stable-key") : null;
    }))
    .toBe("2");
});

test("should put Add job in the top bar and open the link intake from any view", async ({ page }) => {
  await bootSignedIn(page);
  await expect(page.locator(TODAY)).toBeVisible();
  const add = page.locator(".page-top").getByRole("button", { name: "Add job" });
  await expect(add).toBeVisible();
  await add.click();
  await expect(page.locator(PIPELINE)).toBeVisible();
  await expect(page.locator("[data-pipeline-url-modal]")).toBeVisible();
});

test("should open the manual entry, warned, when the top-bar link intake cannot open (C5)", async ({ page }) => {
  await bootSignedIn(page);
  /* The link path fails: the pipeline's URL dialog is not in the page. */
  await page.evaluate(() => {
    document.querySelectorAll("[data-pipeline-url-modal]").forEach((n) => n.remove());
  });
  await page.locator(".page-top").getByRole("button", { name: "Add job" }).click();
  await expect(page.locator("#ingestManualModal")).toBeVisible();
  await expect(page.locator("#ingestManualModalBanner")).toBeVisible();
  await expect(page.locator("#ingestManualModalBannerText")).not.toHaveText("");
});

test("should give an empty pipeline the three ways in, each a real button", async ({ page }) => {
  await bootSignedIn(page, []);
  const today = page.locator(TODAY);
  await expect(today.getByRole("button", { name: "Paste a link" })).toBeVisible();
  await expect(today.getByRole("button", { name: "Add by hand" })).toBeVisible();
  await expect(today.getByRole("button", { name: "Find jobs" })).toBeVisible();
  await expect(today).not.toContainText("Nothing is waiting on you today.");

  await today.getByRole("button", { name: "Paste a link" }).click();
  await expect(page.locator("[data-pipeline-url-modal]")).toBeVisible();
});

test("should band Today and clear a slipped follow-up with one Done, writing each cell once", async ({ page }) => {
  const { writes } = await bootSignedIn(page);
  const today = page.locator(TODAY);
  await expect(today.getByRole("heading", { name: "You owe an answer" })).toBeVisible();
  await expect(today.getByRole("heading", { name: "Follow-up slipped" })).toBeVisible();
  await expect(today.getByRole("heading", { name: "Worth a look" })).toBeVisible();

  const juniper = today.locator('[data-today-reason="follow-up"]', { hasText: "Juniper" });
  await expect(juniper.getByRole("button", { name: "Snooze" })).toBeVisible();
  await expect(juniper.getByRole("button", { name: "Add to calendar" })).toBeVisible();
  await juniper.getByRole("button", { name: "Done" }).click();

  await expect(today.locator('[data-today-reason="follow-up"]', { hasText: "Juniper" })).toHaveCount(0);
  const rWrites = writes.filter((w) => /Pipeline!R\d+/.test(w.url));
  const pWrites = writes.filter((w) => /Pipeline!P\d+/.test(w.url));
  expect(rWrites.length, "Last contact is written once").toBe(1);
  expect(pWrites.length, "Follow-up Date is written once").toBe(1);

  const tidewater = today.locator('[data-today-reason="reply"]', { hasText: "Tidewater" });
  await expect(tidewater.getByRole("button", { name: "Mark answered" })).toBeVisible();
  await tidewater.getByRole("button", { name: "Mark answered" }).click();
  await expect(today.locator('[data-today-reason="reply"]', { hasText: "Tidewater" })).toHaveCount(0);
});

test("should keep the bar usable at 375: views on screen, account whole, More menu closes on Escape", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await bootSignedIn(page);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, "no sideways page scroll").toBeLessThanOrEqual(0);

  const nav = page.getByRole("navigation", { name: "Views" });
  await expect(nav.getByRole("button", { name: /Pipeline/ })).toBeVisible();

  const account = page.locator("#authSection");
  const box = await account.boundingBox();
  expect(box, "the account control is on screen").not.toBeNull();
  expect(box.x + box.width).toBeLessThanOrEqual(375);

  const more = page.getByRole("button", { name: "More actions" });
  await more.click();
  await expect(more).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator("#jb-page-top-more #sheetLink")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(more).toHaveAttribute("aria-expanded", "false");
  await expect(more).toBeFocused();

  /* TR-21: no "0" badge — a hidden expired-review button is not drawn. */
  const expiredDisplay = await page.evaluate(() => {
    const b = document.getElementById("expiredReviewBtn");
    return b && b.hidden ? getComputedStyle(b).display : "n/a";
  });
  expect(["none", "n/a"]).toContain(expiredDisplay);
});

/* ---- fix round 1: review findings ---- */

async function openPipelineCard(page, key) {
  await page.getByRole("navigation", { name: "Views" }).getByRole("button", { name: /Pipeline/ }).click();
  const expand = page.getByRole("button", { name: "Expand Discovered" });
  if (await expand.count()) await expand.click();
  const card = page.locator(`.pipe-sticker[data-stable-key="${key}"]`);
  await expect(card).toBeVisible();
  return card;
}

test("should keep focus in the title input when the card pencil opens the dossier", async ({ page }) => {
  await bootSignedIn(page);
  const card = await openPipelineCard(page, "2");
  await card.hover();
  await card.locator('[data-card-action="edit-open"]').click();
  await expect(page.locator(ROLE)).toBeVisible();
  const title = page.locator(`${ROLE} [data-action="edit-field"][data-field="title"]`);
  await expect(title).toBeFocused();
  /* focusHeading used to run a tick later and steal focus; wait past it. */
  await page.evaluate(() => new Promise((r) => setTimeout(r, 50)));
  await expect(title).toBeFocused();
});

test("should show the dossier again when the role already open is opened from another view", async ({ page }) => {
  await bootSignedIn(page);
  const nav = page.getByRole("navigation", { name: "Views" });
  const card = await openPipelineCard(page, "2");
  await card.click();
  await expect(page.locator(ROLE)).toBeVisible();

  /* Leave by a pill (openRole stays "2"), then open card 2 again. */
  await nav.getByRole("button", { name: /Pipeline/ }).click();
  await expect(page.locator(ROLE)).toBeHidden();
  await card.click();
  await expect(page.locator(ROLE)).toBeVisible();
  await expect(page.locator(PIPELINE)).toBeHidden();

  /* Same through the Brief's and Today's own open paths. */
  await nav.getByRole("button", { name: /Today/ }).click();
  await expect(page.locator(ROLE)).toBeHidden();
  await page.evaluate(() => window.JobBoredFlowing.openRole.set("2"));
  await expect(page.locator(ROLE)).toBeVisible();
  await expect(nav.getByRole("button", { name: /Dossier/ })).toHaveAttribute("aria-current", "page");
});

test("should not call a loading or failed pipeline empty in the Brief", async ({ page }) => {
  await bootSignedIn(page, []);
  const dawn = page.locator('[data-region="dawn"]');
  await expect(dawn).toContainText("No active roles to lead with today.");

  await page.evaluate(() => document.dispatchEvent(new CustomEvent("jb:data:loading")));
  await expect(dawn).not.toContainText("No active roles to lead with today.");
  await expect(dawn.locator("[data-brief-empty]")).toHaveCount(0);
  await expect(dawn).toContainText("Loading your pipeline");

  await page.evaluate(() => document.dispatchEvent(new CustomEvent("jb:data:load-failed")));
  await expect(dawn).not.toContainText("No active roles to lead with today.");
  await expect(dawn.locator("[data-brief-empty]")).toHaveCount(0);
  await expect(dawn).toContainText("didn't load");

  await page.evaluate(() => document.dispatchEvent(new CustomEvent("jb:data:loaded")));
  await expect(dawn).toContainText("No active roles to lead with today.");
});

test("should move a snoozed reply with no Last contact out of You owe an answer", async ({ page }) => {
  const { writes } = await bootSignedIn(page, [
    row({ title: "Frontend Engineer", company: "Tidewater", status: "Applied", replied: "Yes" }),
  ]);
  const today = page.locator(TODAY);
  const tidewater = today.locator('[data-today-reason="reply"]', { hasText: "Tidewater" });
  await expect(tidewater).toBeVisible();
  await tidewater.getByRole("button", { name: "Snooze" }).click();
  await today.getByRole("button", { name: /In 2 days/ }).click();
  await expect.poll(() => writes.filter((w) => /Pipeline!P\d+/.test(w.url)).length).toBe(1);
  await expect(today.locator('[data-today-reason="reply"]', { hasText: "Tidewater" })).toHaveCount(0);
});

test("should focus the pipeline search on Cmd/Ctrl+K from the Today and Dossier views", async ({ page }) => {
  await bootSignedIn(page);
  const search = page.locator(`${PIPELINE} [data-pipeline-search]`);
  const nav = page.getByRole("navigation", { name: "Views" });

  /* From Today, where the dashboard opens. */
  await expect(page.locator(TODAY)).toBeVisible();
  await page.keyboard.press("ControlOrMeta+k");
  await expect(page.locator(PIPELINE)).toBeVisible();
  await expect(page.locator(TODAY)).toBeHidden();
  await expect(nav.getByRole("button", { name: /Pipeline/ })).toHaveAttribute("aria-current", "page");
  await expect(search).toBeFocused();

  /* From the Dossier view. */
  const card = await openPipelineCard(page, "2");
  await card.click();
  await expect(page.locator(ROLE)).toBeVisible();
  await page.keyboard.press("ControlOrMeta+k");
  await expect(page.locator(PIPELINE)).toBeVisible();
  await expect(page.locator(ROLE)).toBeHidden();
  await expect(search).toBeFocused();
});
