/**
 * board-apply.spec.mjs — UX01 lane D (C17, C19) in a real browser.
 *
 * Seeds three fictional rows through the app's own setter (the case-dossier
 * recipe) and pins what the audit measured as broken on feat/ux-zero-to-one:
 *   - TR-09  only Researching was open; Discovered hid behind a 56 px rail.
 *   - TR-08  at 375 px the open column was 22 px wide (AX-01).
 *   - TR-07  the stage menu painted under the next card (AX-02).
 *   - AX-04  a keyboard-focused card showed no focus ring.
 *   - AX-13  each card was a role=button around eleven buttons.
 * Nothing here clicks a stage move, so no Sheet write is attempted.
 */

import { test, expect } from "@playwright/test";
import {
  installHermeticNetworkFence,
  startHermeticApp,
} from "../e2e-fixtures/hermetic-harness.mjs";

const REGION = '[data-region="pipeline"]';

let app = null;

test.beforeAll(async () => {
  app = await startHermeticApp();
});

test.afterAll(async () => {
  if (app) await app.close();
});

function jobs() {
  const base = {
    location: "Remote",
    source: "Ashby",
    salary: "$150–180k",
    priority: "⚡",
    tags: "Platform",
    notes: "",
    followUpDate: "",
    responseFlag: "No",
    favorite: false,
    dateFoundRaw: "2026-09-20",
  };
  return [
    { ...base, title: "Staff Platform Engineer", company: "Chronicle", link: "https://jobs.example.test/a", fitScore: 8, status: "Researching" },
    { ...base, title: "Design Systems Lead", company: "Meridian Labs", link: "https://jobs.example.test/b", fitScore: 7, status: "Researching" },
    { ...base, title: "Product Engineer", company: "Kestrel", link: "https://jobs.example.test/c", fitScore: 6, status: "New" },
  ];
}

async function bootBoard(page, { width, height, rows = jobs() }) {
  await page.setViewportSize({ width, height });
  const fence = await installHermeticNetworkFence(page, { baseUrl: app.baseUrl });
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(true);
  await page.addInitScript(() => {
    try {
      localStorage.removeItem("jb_pipelineColumns.v2");
      localStorage.removeItem("jb_pipelineView");
    } catch (_) {
      /* storage unavailable */
    }
  });
  await page.goto(`${app.baseUrl}/?greenfield=1`, { waitUntil: "load" });
  await page.waitForFunction(() => !!(window.JobBoredApp && window.JobBoredApp.core && window.JobBoredApp.core.setPipelineData));
  const seeded = await page.evaluate((rows) => {
    const core = window.JobBoredApp.core;
    const render = window.JobBoredApp.pipelineRender;
    core.setPipelineData(rows);
    if (render && typeof render.renderPipeline === "function") render.renderPipeline();
    const host = core.host;
    if (host && typeof host.revealDashboardShell === "function") host.revealDashboardShell();
    document.body.classList.add("jb-v2");
    // C18 makes Today the default view; these specs exercise the board.
    const flowing = window.JobBoredFlowing;
    if (flowing && flowing.views && typeof flowing.views.show === "function") {
      flowing.views.show("pipeline", { focus: false });
    }
    if (window.JobBoredPipeline && typeof window.JobBoredPipeline.scheduleRender === "function") {
      window.JobBoredPipeline.scheduleRender();
    }
    return core.getPipelineData().length;
  }, rows);
  expect(seeded).toBe(rows.length);
  await expect(page.locator(`${REGION} .pipe-sticker`).first()).toBeVisible({ timeout: 15_000 });
  await page.locator(REGION).scrollIntoViewIfNeeded();
  return fence;
}

test("should open every stage that holds a role at 1440 (TR-09)", async ({ page }) => {
  const fence = await bootBoard(page, { width: 1440, height: 900 });
  const col = (stage) => page.locator(`${REGION} .pipe-col[data-stage="${stage}"]`);
  await expect(col("new")).toHaveAttribute("data-collapsed", "false");
  await expect(col("researching")).toHaveAttribute("data-collapsed", "false");
  await expect(col("applied")).toHaveAttribute("data-collapsed", "true");
  await expect(page.locator(REGION)).toHaveAttribute("data-view", "board");
  expect(fence.unexpectedExternal).toEqual([]);
});

test("should show a readable list under 760 px with a Board toggle (TR-08, MP-09)", async ({ page }) => {
  await bootBoard(page, { width: 375, height: 812 });
  await expect(page.locator(REGION)).toHaveAttribute("data-view", "list");
  const card = page.locator(`${REGION} .pipe-sticker`).first();
  await expect(card).toBeVisible();
  const box = await card.boundingBox();
  expect(box.width, "a phone card must be readable, not 26 px").toBeGreaterThan(280);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, "no horizontal page scroll at 375").toBeLessThanOrEqual(1);

  await page.locator(`${REGION} [data-pipeline-view="board"]`).click();
  await expect(page.locator(REGION)).toHaveAttribute("data-view", "board");
});

test("should paint the stage menu above the next card (TR-07, AX-02)", async ({ page }) => {
  await bootBoard(page, { width: 1440, height: 900 });
  const first = page.locator(`${REGION} .pipe-col[data-stage="researching"] .pipe-sticker`).first();
  const trigger = first.locator('[data-action="move-to-stage"]');
  await trigger.scrollIntoViewIfNeeded();
  await trigger.click();
  const items = page.locator('.jb-a11y-stage-menu__list:not([hidden]) [role="menuitem"]');
  await expect(items.first()).toBeVisible();
  const count = await items.count();
  for (let i = 0; i < count; i++) {
    const hit = await items.nth(i).evaluate((el) => {
      const r = el.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return !!top && (top === el || el.contains(top));
    });
    expect(hit, `menu item ${i} must be the element under its own centre`).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
});

test("should give a keyboard-focused card a ring and a real Open dossier button (AX-04, AX-13)", async ({ page }) => {
  await bootBoard(page, { width: 1440, height: 900 });
  const card = page.locator(`${REGION} .pipe-sticker`).first();
  expect(await card.getAttribute("role")).toBeNull();
  const open = card.locator('[data-card-action="open"]');
  await expect(open).toHaveAttribute("aria-label", /^Open dossier: /);
  await open.focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  const ring = await open.evaluate((el) => getComputedStyle(el).boxShadow);
  expect(ring, "focus-visible must paint the focus ring").not.toBe("none");
});

/* Conformance pass (mockup frame "The Pipeline view"): a full pipeline. */
function fullPipeline() {
  const base = jobs()[0];
  const row = (title, company, status, extra = {}) => ({
    ...base,
    title,
    company,
    status,
    link: `https://jobs.example.test/${encodeURIComponent(company)}`,
    ...extra,
  });
  return [
    row("Senior Product Designer", "Lumen Labs", "New", { location: "Remote (US)", salary: "$170–210k", tags: "Design, Systems, Figma" }),
    row("Staff Frontend Engineer", "Kestrel", "Researching", { location: "Remote", salary: "$190–240k" }),
    row("Product Engineer", "Juniper Bank", "Applied", { location: "Brooklyn", salary: "$160–200k", appliedDate: "2026-09-19" }),
    row("Frontend Engineer", "Tidewater", "Phone Screen", { location: "Boston, hybrid", salary: "" }),
    row("Design Engineer", "Orbital", "Interviewing", { location: "Remote", salary: "$175–215k" }),
    row("Software Engineer, Payments UI", "Brightline", "Offer", { location: "Seattle", salary: "$175k" }),
    row("Platform Engineer", "Quarry", "Rejected"),
    row("UI Engineer", "Fathom", "Passed"),
    row("Web Engineer", "Ledger", "Expired"),
  ];
}

test("should fit all six active stages on screen at 1440 and collapse the closed ones into a chip row (C19)", async ({ page }) => {
  await bootBoard(page, { width: 1440, height: 900, rows: fullPipeline() });
  const active = ["new", "researching", "applied", "phone-screen", "interviewing", "offer"];
  for (const stage of active) {
    const col = page.locator(`${REGION} .pipe-board .pipe-col[data-stage="${stage}"]`);
    await expect(col).toHaveAttribute("data-collapsed", "false");
    const box = await col.boundingBox();
    expect(box, `${stage} column renders`).not.toBeNull();
    expect(box.x + box.width, `${stage} column fits inside 1440`).toBeLessThanOrEqual(1440);
  }
  for (const stage of ["rejected", "passed", "expired"]) {
    await expect(page.locator(`${REGION} .pipe-board .pipe-col[data-stage="${stage}"]`)).toHaveCount(0);
  }
  const closed = page.locator(`${REGION} .pipe-closed`);
  await expect(closed).toBeVisible();
  await expect(closed).toContainText("Closed");
  await expect(closed.locator('[data-stage-toggle="rejected"]')).toContainText(/Rejected\s*1/);
  await expect(closed.locator('[data-stage-toggle="passed"]')).toContainText(/Passed\s*1/);
  await expect(closed.locator('[data-stage-toggle="expired"]')).toContainText(/Expired\s*1/);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, "no horizontal page scroll at 1440").toBeLessThanOrEqual(1);

  // A closed chip opens its roles in place.
  await closed.locator('[data-stage-toggle="rejected"]').click();
  await expect(closed.locator('.pipe-col[data-stage="rejected"] .pipe-sticker')).toBeVisible();
});

test("should rest a card at company, fit, title and one place · pay line (TR-16)", async ({ page }) => {
  for (const size of [{ width: 1440, height: 900 }, { width: 375, height: 812 }]) {
    await bootBoard(page, { ...size, rows: fullPipeline() });
    const card = page.locator(`${REGION} .pipe-sticker[data-stage="applied"]`).first();
    await expect(card).toBeVisible();
    await expect(card.locator(".pipe-sticker__meta")).toHaveText("Brooklyn · $160–200k");
    await expect(card.locator(".pipe-sticker__detail")).toBeHidden();
    await expect(card.locator(".pipe-sticker__salary")).toBeHidden();
    const chips = await card.locator(".pipe-sticker__flag:visible, .jb-applied-age:visible").count();
    expect(chips, "at most one status chip").toBeLessThanOrEqual(1);
    const box = await card.boundingBox();
    expect(box.height, `a resting card is compact at ${size.width}`).toBeLessThanOrEqual(130);
  }
});
