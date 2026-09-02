/**
 * case-dossier.spec.mjs — real-browser smoke for The Case dossier.
 *
 * Lane V1 (claim V). Every prior Case assertion ran inside a node:vm stub
 * DOM. This spec boots the dashboard the way boot-smoke does, seeds three
 * fictional pipeline rows through the app's own setter, opens a role, and
 * proves the Case is painted, hittable, and guarded against a mid-edit
 * re-render.
 *
 * Run:
 *   npm run test:e2e-smoke
 */

import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect } from "@playwright/test";
import {
  installHermeticNetworkFence,
  startHermeticApp,
} from "../e2e-fixtures/hermetic-harness.mjs";

const DEMO_BOARD = "#oneFlowDemoBoard";
const ROLE_REGION = '[data-region="role"]';
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const EVIDENCE_DIR = join(REPO_ROOT, ".lane-evidence");
const TYPED_NOTE = "V1 typed note that must survive a render";

let app = null;

test.beforeAll(async () => {
  app = await startHermeticApp();
});

test.afterAll(async () => {
  if (app) await app.close();
});

async function bootGreenfield(page) {
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => {
    consoleErrors.push(`pageerror: ${err.message}`);
  });
  const fence = await installHermeticNetworkFence(page, { baseUrl: app.baseUrl });
  await page.emulateMedia({ reducedMotion: "reduce" });
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

async function expectClickableBox(locator, label) {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  expect(box, `${label} should have a bounding box`).not.toBeNull();
  expect(box.width).toBeGreaterThan(0);
  expect(box.height).toBeGreaterThan(0);
}

function isoDatePlus(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function fixtureJobs() {
  const followUpDate = isoDatePlus(3);
  const scrapedAt = new Date(Date.now() - 2 * 3600e3).toISOString();
  return [
    {
      title: "Senior Product Manager",
      company: "Meridian Labs",
      location: "Austin, TX",
      link: "https://jobs.meridian-labs.test/senior-pm",
      source: "Ashby",
      salary: "$185–230k",
      fitScore: 8,
      priority: "⚡",
      tags: "Design Systems, Accessibility",
      status: "Researching",
      notes: "Recruiter: Dana",
      followUpDate,
      responseFlag: "No",
      favorite: true,
      dateFoundRaw: "2026-08-29",
      _postingEnrichment: {
        roleInOneLine: "Design **infrastructure** that ships.",
        mustHaves: ["5+ years of **bold** design systems", "- WCAG 2.2"],
        toolsAndStack: ["React", "Storybook"],
        talkingPoints: ["Shipped tokens; cut drift 80%"],
        requirements: ["5+ years design systems", "WCAG 2.2"],
        skills: ["React"],
        scrapedAt,
        _parseMode: "loose",
      },
    },
    {
      title: "Staff Platform Engineer",
      company: "Chronicle",
      location: "Remote",
      link: "https://jobs.chronicle.test/staff-platform",
      source: "Greenhouse",
      salary: "$210–250k",
      fitScore: 7,
      priority: "⚡",
      tags: "Distributed systems",
      status: "New",
      notes: "",
      followUpDate,
      responseFlag: "No",
      favorite: false,
      dateFoundRaw: "2026-08-30",
      _postingEnrichment: {
        roleInOneLine: "Keep the mesh boring and the pages fast.",
        mustHaves: ["**Kubernetes** at scale", "- Observability ownership"],
        toolsAndStack: ["Go", "Kubernetes"],
        talkingPoints: ["Ran a multi-region control plane"],
        requirements: ["Kubernetes at scale"],
        skills: ["Go"],
        scrapedAt,
      },
    },
    {
      title: "Design Systems Lead",
      company: "Meridian Labs",
      location: "Austin, TX",
      link: "https://jobs.meridian-labs.test/ds-lead",
      source: "Ashby",
      salary: "$175–210k",
      fitScore: 6,
      priority: "⚡",
      tags: "Design Systems",
      status: "Researching",
      notes: "",
      followUpDate,
      responseFlag: "No",
      favorite: true,
      dateFoundRaw: "2026-08-28",
      _postingEnrichment: {
        roleInOneLine: "Own the token pipeline.",
        mustHaves: ["Token pipeline"],
        toolsAndStack: ["Figma", "React"],
        talkingPoints: ["Cut visual drift"],
        requirements: ["Design tokens"],
        skills: ["Figma"],
        scrapedAt,
      },
    },
  ];
}

/**
 * Seed through the same setter the Sheet loader uses
 * (bridge-registry.js Object.assign(app.core, { setPipelineData })),
 * paint the board so dawn-data can read the cards, then reveal the
 * dashboard shell the way sheets-read-load.js does after a real load
 * so the v2 role region is no longer display:none.
 */
async function seedPipelineThroughApp(page, jobs) {
  const result = await page.evaluate((fixtureJobs) => {
    const core = window.JobBoredApp && window.JobBoredApp.core;
    const render = window.JobBoredApp && window.JobBoredApp.pipelineRender;
    const host = core && core.host;
    if (!core || typeof core.setPipelineData !== "function") {
      return { ok: false, seam: "window.JobBoredApp.core.setPipelineData" };
    }
    if (!render || typeof render.renderPipeline !== "function") {
      return { ok: false, seam: "window.JobBoredApp.pipelineRender.renderPipeline" };
    }
    core.setPipelineData(fixtureJobs);
    render.renderPipeline();
    if (host && typeof host.revealDashboardShell === "function") {
      host.revealDashboardShell();
    }
    // Default config.example.js sets resumeProvider to "gemini", and the
    // Case record title-cases that id onto "Enriched". Ground rule 9 / this
    // spec forbid vendor names in the role region. "webhook" is a named
    // provider that cannot enrich without a URL, so it will not overwrite
    // the fixture `_postingEnrichment` the way "local" does.
    const overrides = window.JobBoredApp && window.JobBoredApp.configOverrides;
    if (overrides && typeof overrides.applyConfigOverridesToWindowConfig === "function") {
      overrides.applyConfigOverridesToWindowConfig({ resumeProvider: "webhook" });
    }
    const data = typeof core.getPipelineData === "function" ? core.getPipelineData() : [];
    const dashboard = document.getElementById("dashboard");
    return {
      ok: true,
      count: Array.isArray(data) ? data.length : 0,
      dashboardDisplay: dashboard ? dashboard.style.display : "",
    };
  }, jobs);
  if (!result.ok) {
    throw new Error(
      `Cannot seed the pipeline without touching app source; missing seam: ${result.seam}`,
    );
  }
  expect(result.count, "seeded pipeline should hold the three fixture jobs").toBe(3);
  expect(
    result.dashboardDisplay === "block" || result.dashboardDisplay === "flex",
    `v2 role region stays hidden unless #dashboard is shown (got display=${result.dashboardDisplay})`,
  ).toBe(true);
}

async function screenshotCase(page, width, height, evidenceName) {
  await page.setViewportSize({ width, height });
  await page.evaluate(() => {
    document.querySelectorAll(".toast").forEach((el) => el.remove());
  });
  const caseRoot = page.locator(`${ROLE_REGION} .case`);
  await expect(caseRoot).toBeVisible();
  /* Screenshots land in gitignored .lane-evidence/ only. The archived
     V1-case-*.png under docs/programs/dossier-case/reports/ are the
     one-time verification record and must not churn on every run. */
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  const evidencePath = join(EVIDENCE_DIR, evidenceName);
  await caseRoot.screenshot({ path: evidencePath, animations: "disabled" });
}

test("The Case renders in a real browser from seeded pipeline data", async ({ page }) => {
  const consoleErrors = await bootGreenfield(page);
  // Boot continues after S0 paints (auth bootstrap, readiness checks, the
  // index.html blank-shell watchdog). Give the async tail a beat before we
  // seed, so boot noise is in the same collector as the Case assertions.
  await page.waitForTimeout(3_000);

  await seedPipelineThroughApp(page, fixtureJobs());
  // Legacy kanban is display:none under body.jb-v2; dawn-data still reads
  // the hidden cards. Assert attached, not visible.
  await expect(page.locator('.kanban-card[data-stable-key="0"]')).toBeAttached({
    timeout: 10_000,
  });
  await expect(page.locator(DEMO_BOARD)).toHaveCount(0);

  await page.evaluate(() => {
    window.JobBoredFlowing.openRole.set("0");
  });

  const caseRoot = page.locator(`${ROLE_REGION} .case`);
  await expect(caseRoot).toBeVisible({ timeout: 10_000 });
  await caseRoot.evaluate((el) => el.scrollIntoView({ block: "start" }));

  const rail = page.locator(`${ROLE_REGION} .case__rail`);
  const nowStep = page.locator(`${ROLE_REGION} .case__stepper .case__step--now`);
  const fit = page.locator(`${ROLE_REGION} .case__numbers [data-num="fit"]`);
  const theyWant = page.locator(`${ROLE_REGION} .case__lane--they li[data-status]`);
  const materials = page.locator(
    `${ROLE_REGION} .case__lane--moves [data-mount="materials"]`,
  );
  const notes = page.locator(`${ROLE_REGION} .case__notes textarea`);
  const record = page.locator(`${ROLE_REGION} .case__chron .case__ev`);

  await expectClickableBox(rail, "status rail");
  await expectClickableBox(nowStep, "current stepper step");
  await expectClickableBox(fit, "fit number tile");
  await expectClickableBox(theyWant.first(), "they-want requirement");
  await expectClickableBox(materials, "materials mount");
  await expectClickableBox(notes, "notes textarea");
  await expectClickableBox(record.first(), "record event");

  const roleText = await page.locator(ROLE_REGION).innerText();
  const roleHtml = await page.locator(ROLE_REGION).innerHTML();
  expect(roleText, "rendered text must not leak markdown").not.toContain("**");
  expect(roleHtml, "HTML must not double-escape").not.toContain("&amp;amp;");
  expect(roleText, "rendered text must not stringify objects").not.toContain(
    "[object Object]",
  );
  expect(roleHtml).not.toContain("[object Object]");
  expect(roleText, "vendor names must not appear in the role region").not.toMatch(
    /Gemini/i,
  );

  const liTexts = await page.locator(`${ROLE_REGION} li`).allTextContents();
  for (const text of liTexts) {
    expect(
      text.trimStart().startsWith("- "),
      `list item must not keep a leading "- " glyph: ${JSON.stringify(text)}`,
    ).toBe(false);
  }

  await screenshotCase(
    page,
    1440,
    900,
    "V1-case-desktop.png",
  );
  await screenshotCase(
    page,
    720,
    1200,
    "V1-case-mobile.png",
  );
  await page.setViewportSize({ width: 1440, height: 900 });
  await caseRoot.evaluate((el) => el.scrollIntoView({ block: "start" }));

  await page.evaluate(() => {
    window.__jbMoveEvents = [];
    window.addEventListener("jb:pipeline:move", (event) => {
      window.__jbMoveEvents.push(event.detail);
    });
  });
  const applied = page.locator(
    `${ROLE_REGION} [data-action="stage-step"][data-stage="applied"]`,
  );
  await applied.scrollIntoViewIfNeeded();
  await applied.click();
  const moves = await page.evaluate(() => window.__jbMoveEvents);
  expect(moves).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        fromStage: "researching",
        toStage: "applied",
      }),
    ]),
  );

  // Applied is gated by the submission confirmation dialog. Dismiss it so
  // the notes surface stays hittable; the move event already fired.
  const cancelDialog = page.locator(".jb-a11y-dialog__btn--cancel");
  if ((await cancelDialog.count()) > 0) {
    await cancelDialog.click();
    await expect(page.locator(".jb-a11y-dialog")).toHaveCount(0);
  }

  await notes.click();
  await notes.fill(TYPED_NOTE);
  const notesHandle = await notes.elementHandle();
  expect(notesHandle, "notes textarea should be in the DOM").not.toBeNull();
  await page.evaluate(() => {
    document.dispatchEvent(new CustomEvent("jb:pipeline:rendered", { bubbles: true }));
  });
  await expect(notes).toHaveValue(TYPED_NOTE);
  expect(
    await notesHandle.evaluate((el) => el.isConnected),
    "a focused notes edit must survive jb:pipeline:rendered",
  ).toBe(true);

  await notes.blur();
  await expect
    .poll(() => notesHandle.evaluate((el) => el.isConnected))
    .toBe(false);

  expect(consoleErrors, "the Case run must be console-error free").toEqual([]);
});
