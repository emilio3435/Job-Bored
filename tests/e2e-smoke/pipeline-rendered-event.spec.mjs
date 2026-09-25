/**
 * pipeline-rendered-event.spec.mjs — UX01 cleanup lane cA (DS-08, TR-20).
 *
 * The v2 board and Dawn used to repaint only because a MutationObserver saw
 * the hidden legacy #jobCards board change. These checks pin the new trigger:
 * every legacy pipeline render dispatches `jb:pipeline:rendered` on document
 * with `detail.count`, and the v2 board and Dawn repaint off that event even
 * when nothing observes #jobCards. The ?jb-v2=0 check keeps the legacy board
 * working, because retiring that view is not approved.
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

function row(title, company, status, n) {
  return {
    title,
    company,
    status,
    link: `https://jobs.example.test/${n}`,
    location: "Remote",
    source: "Ashby",
    salary: "",
    priority: "",
    tags: "",
    notes: "",
    followUpDate: "",
    responseFlag: "",
    favorite: false,
    fitScore: 7,
    dateFoundRaw: "2026-09-20",
  };
}

const TWO = [row("Staff Engineer", "Chronicle", "Researching", 1), row("Product Engineer", "Kestrel", "New", 2)];
const THREE = [...TWO, row("Design Lead", "Meridian Labs", "Applied", 3)];

async function boot(page, path) {
  const fence = await installHermeticNetworkFence(page, { baseUrl: app.baseUrl });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`${app.baseUrl}${path}`, { waitUntil: "load" });
  await page.waitForFunction(
    () => !!(window.JobBoredApp && window.JobBoredApp.core && window.JobBoredApp.pipelineRender),
  );
  await page.evaluate(() => {
    window.__jbRendered = [];
    document.addEventListener("jb:pipeline:rendered", (e) => {
      window.__jbRendered.push(e.detail ? e.detail.count : undefined);
    });
    const host = window.JobBoredApp.core.host;
    if (host && typeof host.revealDashboardShell === "function") host.revealDashboardShell();
  });
  return fence;
}

async function seed(page, rows) {
  await page.evaluate((r) => {
    window.JobBoredApp.core.setPipelineData(r);
    window.JobBoredApp.pipelineRender.renderPipeline();
  }, rows);
}

test("v2: the board and Dawn repaint off jb:pipeline:rendered, not #jobCards mutations", async ({ page }) => {
  const fence = await boot(page, "/?greenfield=1");
  expect(await page.evaluate(() => document.body.classList.contains("jb-v2"))).toBe(true);

  await seed(page, TWO);
  await expect(page.locator('[data-region="pipeline"] .pipe-sticker[data-stable-key]')).toHaveCount(2);
  await expect.poll(() => page.evaluate(() => window.JobBoredDawn._lastVM && window.JobBoredDawn._lastVM.total)).toBe(2);

  // Cut the legacy DOM trigger. Only the event is left to drive a repaint.
  await page.evaluate(() => {
    const p = window.JobBoredPipeline && window.JobBoredPipeline._observers;
    if (p && p.mo) p.mo.disconnect();
    const d = window.JobBoredDawn && window.JobBoredDawn._observers;
    if (d && d.mo) d.mo.disconnect();
    window.__jbRendered = [];
  });

  await seed(page, THREE);
  expect(await page.evaluate(() => window.__jbRendered)).toEqual([3]);
  await expect(page.locator('[data-region="pipeline"] .pipe-sticker[data-stable-key]')).toHaveCount(3);
  await expect.poll(() => page.evaluate(() => window.JobBoredDawn._lastVM && window.JobBoredDawn._lastVM.total)).toBe(3);

  // An emptied pipeline is a render too: the event fires with count 0.
  await page.evaluate(() => { window.__jbRendered = []; });
  await seed(page, []);
  expect(await page.evaluate(() => window.__jbRendered)).toEqual([0]);
  await expect(page.locator('[data-region="pipeline"] .pipe-sticker[data-stable-key]')).toHaveCount(0);

  expect(fence.unexpectedExternal).toEqual([]);
});

test("?jb-v2=0 still renders the legacy board and announces it", async ({ page }) => {
  const fence = await boot(page, "/?greenfield=1&jb-v2=0");
  expect(await page.evaluate(() => document.body.classList.contains("jb-v2"))).toBe(false);

  await seed(page, THREE);
  const cards = page.locator("#jobCards .pipeline-board .kanban-card[data-stable-key]");
  await expect(cards).toHaveCount(3);
  await expect(cards.first()).toBeVisible();
  await expect(page.locator("#pipelineSection")).toBeVisible();
  expect(await page.evaluate(() => window.__jbRendered)).toEqual([3]);

  expect(fence.unexpectedExternal).toEqual([]);
});
