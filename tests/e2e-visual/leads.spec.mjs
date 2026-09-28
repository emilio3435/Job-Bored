/* global window, document, matchMedia -- evaluated in the browser page */
/**
 * LEADTABS Q1: the look of Leads, Filters and Chat, at 1440 and 375.
 *
 * Each case asserts structure first (the mode toggle, the active panel, no
 * sideways overflow), then compares a screenshot with its baseline. Font
 * rasterization differs by OS, so baselines carry the platform suffix and
 * only exist for the platforms they were recorded on. On a platform with no
 * baseline the pixel compare is skipped with an annotation; the structural
 * checks still run. The suite's config sets updateSnapshots "none", so only
 * an explicit `--update-snapshots=missing` records a new baseline.
 *
 * Hermetic: the harness fence answers every off-origin and host path, and
 * /profile is stubbed with a fictional document.
 */

import { existsSync } from "node:fs";
import { test, expect } from "@playwright/test";
import {
  installHermeticNetworkFence,
  startHermeticApp,
} from "../e2e-fixtures/hermetic-harness.mjs";

let app;

test.beforeAll(async () => {
  app = await startHermeticApp();
});

test.afterAll(async () => {
  await app?.close();
});

const VIEWPORTS = [
  ["1440", { width: 1440, height: 1000 }],
  ["375", { width: 375, height: 812 }],
];

// A local calendar date at noon, so "Today" and "1d" hold at any hour.
function isoDaysAgo(n) {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() - n);
  const pad = (v) => String(v).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function row(n, title, company, location, salary, fit, status, days) {
  return {
    title,
    company,
    status,
    link: `https://jobs.example.test/${n}`,
    location,
    source: "greenhouse",
    salary,
    priority: "",
    tags: "",
    notes: "",
    followUpDate: "",
    responseFlag: "",
    favorite: false,
    fitScore: fit,
    matchScore: fit * 10,
    dateFoundRaw: isoDaysAgo(days),
    fitAssessment: "Fictional fixture row.",
    workMode: "",
    workModeSource: "",
  };
}

const ROWS = [
  row(1, "Director, Revenue Operations", "Northwind Analytics", "Remote - US", "$185k - $215k", 9, "Researching", 1),
  row(2, "Senior Manager, Revenue Operations", "Kestrel Health", "Hybrid - Austin, TX", "$160k - $180k", 8, "New", 0),
  row(3, "Revenue Operations Manager", "Chronicle", "Remote", "$140k - $165k", 7, "Applied", 4),
  row(4, "Sales Operations Lead", "Meridian Labs", "On-site - Denver, CO", "$150k - $170k", 7, "New", 3),
  row(5, "Revenue Operations Analyst", "Umbrella Retail", "Remote", "$85k - $100k", 5, "New", 2),
  row(6, "Sales Operations Manager", "Vandelay Industries", "On-site - New York", "$125k - $135k", 6, "New", 11),
  row(7, "Account Executive", "Globex", "Remote", "$120k - $140k", 4, "New", 5),
];

const PROFILE = {
  version: 1,
  identity: {
    targetRoles: ["Revenue Operations", "Sales Operations"],
    targetSeniority: "director",
    primaryNarrative: "I build revenue systems for B2B software teams.",
  },
  strengths: [{ name: "Forecasting", evidence: "Built a forecast process from scratch." }],
  hardConstraints: {
    workMode: "any",
    acceptableLocations: [],
    salaryFloor: 120000,
    salaryRequired: false,
    skipTitles: [],
    workAuth: "us_citizen",
  },
  wants: ["Owning revenue systems"],
  avoids: [],
};

const DISCOVERY = {
  targetRoles: "Revenue Operations, Sales Operations",
  seniority: "director",
  keywordsInclude: "RevOps, forecasting",
  keywordsExclude: "",
  maxLeadsPerRun: "15",
  groundedWebEnabled: true,
  sourcePreset: "browser_plus_ats",
  companyBlocklist: [],
};

async function bootLeads(page, viewport) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.setViewportSize(viewport);
  const fence = await installHermeticNetworkFence(page, { baseUrl: app.baseUrl });
  await page.route(`${app.baseUrl}/profile`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, profile: PROFILE }),
    }),
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`${app.baseUrl}/?greenfield=1`, { waitUntil: "load" });
  expect(await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(true);
  await page.waitForFunction(
    () =>
      !!(
        window.JobBoredApp?.core &&
        window.JobBoredApp.pipelineRender &&
        window.JobBoredLeads?.controller() &&
        window.JobBoredLeadsTune &&
        window.CommandCenterUserContent
      ),
  );
  await page.evaluate(
    async ({ rows, profile, discovery }) => {
      await window.CommandCenterUserContent.saveDiscoveryProfile(discovery);
      window.JobBoredApp.core.host?.revealDashboardShell?.();
      rows.forEach((r) => {
        r.dateFound = new Date(r.dateFoundRaw);
      });
      window.JobBoredApp.core.setPipelineData(rows);
      window.JobBoredApp.pipelineRender.renderPipeline();
      window.JobBoredLeads.setProfile({ ...profile, discoveryProfile: discovery });
      window.JobBoredFlowing.views.show("leads", { focus: false });
    },
    { rows: ROWS, profile: PROFILE, discovery: DISCOVERY },
  );
  await expect(page.locator('[data-region="leads"] .jbl-row').first()).toBeVisible();
  return { errors, fence };
}

async function expectNoSidewaysScroll(page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

/**
 * Compare with this platform's baseline. With no baseline the pixel compare
 * is skipped. The config sets updateSnapshots "none", so a normal run never
 * writes; recording a new baseline takes an explicit --update-snapshots flag.
 */
async function compareScreenshot(page, name) {
  const info = test.info();
  const baseline = info.snapshotPath(name, { kind: "screenshot" });
  const recording = info.config.updateSnapshots !== "none";
  if (!existsSync(baseline) && !recording) {
    info.annotations.push({
      type: "skip-pixels",
      description: `no ${name} baseline for ${process.platform}; structural checks only`,
    });
    return;
  }
  await page.mouse.move(0, 0);
  await page.evaluate(() => document.fonts.ready);
  await expect(page).toHaveScreenshot(name, {
    animations: "disabled",
    caret: "hide",
    maxDiffPixelRatio: 0.01,
  });
}

for (const [label, viewport] of VIEWPORTS) {
  test(`Leads Filters at ${label}`, async ({ page }) => {
    const { errors, fence } = await bootLeads(page, viewport);
    const region = page.locator('[data-region="leads"]');
    await expect(region).toHaveAttribute("data-leads-current", "filters");
    await expect(page.locator('.jbl-modes__btn[data-leads-mode="filters"]')).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator('[data-leads-panel="filters"]')).toBeVisible();
    await expect(page.locator('[data-leads-panel="chat"]')).toBeHidden();
    await expect(page.locator("#leadsSearch")).toBeVisible();
    await expectNoSidewaysScroll(page);
    await compareScreenshot(page, `leads-filters-${label}.png`);
    expect(errors).toEqual([]);
    expect(fence.unexpectedExternal).toEqual([]);
    expect(app.hostRequests).toEqual([]);
  });

  test(`Leads Chat at ${label}`, async ({ page }) => {
    const { errors, fence } = await bootLeads(page, viewport);
    await page.locator('.jbl-modes__btn[data-leads-mode="chat"]').click();
    await expect
      .poll(() => page.evaluate(() => window.JobBoredLeadsTune.controller().getState().status))
      .toBe("ready");
    const region = page.locator('[data-region="leads"]');
    await expect(region).toHaveAttribute("data-leads-current", "chat");
    await expect(page.locator('.jbl-modes__btn[data-leads-mode="chat"]')).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator('[data-leads-panel="chat"]')).toBeVisible();
    await expect(page.locator('[data-leads-panel="filters"]')).toBeHidden();
    await expect(page.locator('[data-jbt="nn-find"]')).toHaveText("5");
    await expect(page.locator('[data-jbt="review"]')).toBeHidden();
    await expectNoSidewaysScroll(page);
    await compareScreenshot(page, `leads-chat-${label}.png`);
    expect(errors).toEqual([]);
    expect(fence.unexpectedExternal).toEqual([]);
    expect(app.hostRequests).toEqual([]);
  });
}
