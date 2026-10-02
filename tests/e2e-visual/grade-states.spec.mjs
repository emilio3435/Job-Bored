/**
 * grade-states.spec.mjs — GRADE lane W-FE, the five verdict states in a
 * real browser at 1440 and 375, captured into test-results/grade-states/:
 *
 *   failing-draft        "Fails · 1 claim needs a source" and its Why
 *   repaired-draft       "Ready" after a repair, its modal
 *   version-window       Original draft + Repaired, each downloadable
 *   held                 a repair that still fails: Held, the in-page confirm
 *   reviews-disagree     "Needs review · Reviewers disagree", both verdicts
 *
 * Each state asserts the words (status is never colour alone), no "/ 100",
 * "of 100" or letter grade, and no sideways scroll; the verdict chip fits at
 * 375 with its reason truncated on screen and whole in the aria-label.
 *
 * Hermetic: tests/e2e-fixtures/hermetic-harness.mjs fences Google and the
 * host paths; installGradeMaterialsApi answers the materials routes from
 * W-BE's frozen fixtures and refuses the rest.
 */

/* page.evaluate callbacks run in the browser. */
/* global window, document */
import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  REPO_ROOT,
  installGradeMaterialsApi,
  installHermeticNetworkFence,
  startHermeticApp,
} from "../e2e-fixtures/hermetic-harness.mjs";
import {
  RUNS_REPAIR_HELD,
  RUNS_REPAIR_PASSED,
  V3_READY,
  V3_REPAIRED_READY,
  V3_REPAIR_STILL_FAILING,
  V3_SECOND_DISAGREEMENT,
  V3_UNSUPPORTED,
} from "../fixtures/materials-qa-v3.mjs";

const SLUG = "acme-robotics-dispatch-analyst";
const SECTION = '[data-region="role"] .brief-materials--rows';
const SHOTS = join(REPO_ROOT, "test-results", "grade-states");
const NUMBERS = /\/\s*100|\bof 100\b|\bGrade [A-F][+-]?\b/;
const FILE = (name) => ({ filename: name, format: name.split(".").pop(), size: 2048, modifiedAt: "2026-10-02T09:00:00.000Z" });

let app = null;
test.beforeAll(async () => { app = await startHermeticApp(); mkdirSync(SHOTS, { recursive: true }); });
test.afterAll(async () => { if (app) await app.close(); });

function manifest(letterQa) {
  const doc = (type, stem) => ({
    type, label: type === "resume" ? "Tailored Resume" : "Cover Letter", status: "ready", primary: `${stem}.pdf`,
    lastModifiedAt: "2026-10-02T09:00:00.000Z", files: [FILE(`${stem}.pdf`), FILE(`${stem}.html`)], text: FILE(`${stem}.txt`), exports: {},
  });
  return () => ({
    slug: SLUG, company: "Acme Robotics", title: "Dispatch analyst", derived: false, updatedAt: "2026-10-02T09:10:00.000Z",
    runId: letterQa.runId, documents: [doc("resume", "resume"), doc("cover_letter", "cover-letter")],
    quality: { documents: {
      resume: { status: "pass", issues: [], qa: { ...V3_READY, document: "resume" } },
      cover_letter: { status: letterQa.disposition === "FAIL" ? "fail" : "pass", issues: [], qa: letterQa },
    } },
  });
}

async function openCase(page, { width, letterQa, runs }) {
  await page.setViewportSize({ width, height: width === 375 ? 1400 : 1100 });
  const fence = await installHermeticNetworkFence(page, { baseUrl: app.baseUrl });
  const seen = await installGradeMaterialsApi(page, { slug: SLUG, manifest: manifest(letterQa), runs: () => runs || [] });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`${app.baseUrl}/?greenfield=1`, { waitUntil: "load" });
  await expect(page.locator("#oneFlowDemoBoard")).toBeVisible({ timeout: 15_000 });
  const seeded = await page.evaluate(() => {
    const core = window.JobBoredApp && window.JobBoredApp.core;
    const render = window.JobBoredApp && window.JobBoredApp.pipelineRender;
    if (!core || typeof core.setPipelineData !== "function" || !render) return false;
    core.setPipelineData([{ title: "Dispatch analyst", company: "Acme Robotics", location: "Remote", link: "https://jobs.acme-robotics.test/dispatch",
      source: "Ashby", fitScore: 8, status: "Researching", notes: "", followUpDate: "", responseFlag: "No", favorite: false, dateFoundRaw: "2026-10-01" }]);
    render.renderPipeline();
    if (core.host && typeof core.host.revealDashboardShell === "function") core.host.revealDashboardShell();
    return true;
  });
  expect(seeded, "the pipeline seam is reachable").toBe(true);
  await expect(page.locator('[data-region="pipeline"] .pipe-sticker[data-stable-key="0"]')).toBeAttached({ timeout: 10_000 });
  await page.evaluate(() => window.JobBoredFlowing.openRole.set("0"));
  const section = page.locator(SECTION);
  await expect(section).toBeVisible({ timeout: 15_000 });
  await section.evaluate((el) => el.scrollIntoView({ block: "start" }));
  return { fence, seen, section, letter: section.locator('[data-doc="cover_letter"]') };
}

async function shoot(locator, name, width) {
  const page = locator.page();
  await page.evaluate(() => document.querySelectorAll(".toast").forEach((el) => el.remove()));
  await page.addStyleTag({ content: 'body.jb-v2 [data-region="role"] .case .case__docket { position: static !important; }' });
  await page.mouse.move(0, 0);
  await locator.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await locator.screenshot({ path: join(SHOTS, `${name}-${width}.png`), animations: "disabled" });
}

/* Nothing the reader sees or hears carries a total, a letter or "of 100". */
async function expectNoNumbers(locator) {
  const said = await locator.evaluate((el) => {
    const labels = [...el.querySelectorAll("[aria-label]")].map((n) => n.getAttribute("aria-label"));
    return el.innerText + " " + labels.join(" ");
  });
  expect(said).not.toMatch(NUMBERS);
}

async function expectFits(page, locator, width) {
  const box = await locator.boundingBox();
  expect(box, "it has a box").not.toBeNull();
  expect(box.x + box.width, `it fits a ${width}px viewport`).toBeLessThanOrEqual(width + 1);
  const sideways = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(sideways, "no sideways scroll").toBeLessThanOrEqual(1);
}

function expectHermetic(fence, seen) {
  expect(fence.unexpectedExternal, "nothing escaped the hermetic fence").toEqual([]);
  expect(seen.refused, "every materials call was staged").toEqual([]);
  expect(app.hostRequests, "no /profile* or /__proxy/* reached the dev server").toEqual([]);
}

async function openModal(letter) {
  await letter.locator("[data-score-open]").click();
  const modal = letter.page().locator(".jb-score");
  await expect(modal).toBeVisible();
  return modal;
}

for (const width of [1440, 375]) {
  test.describe(`at ${width}px`, () => {
    test("GRADE-F G1: a failing draft reads Fails and its first reason, and the modal says why", async ({ page }) => {
      const { fence, seen, letter } = await openCase(page, { width, letterQa: V3_UNSUPPORTED });
      const btn = letter.locator("[data-score-open]");
      await expect(btn).toHaveText("Fails · 1 claim needs a source");
      await expect(btn).toHaveAttribute("aria-label", "Cover letter: Fails — 1 claim needs a source. Open the quality check.");
      await expectFits(page, btn, width);
      await shoot(letter, "failing-draft-row", width);
      const modal = await openModal(letter);
      await expect(modal.locator(".jb-score__word")).toHaveText("Fails");
      await expect(modal.locator('[data-step="why"]')).toContainText("Claim needs a source");
      await expect(modal.locator('[data-step="why"] .jb-score__quote')).toHaveText("I built a dispatch forecast at Acme Robotics.");
      await expectNoNumbers(modal);
      await shoot(modal.locator(".jb-score__card"), "failing-draft", width);
      expectHermetic(fence, seen);
    });

    test("GRADE-F G6: a repaired draft reads Ready", async ({ page }) => {
      const { fence, seen, letter } = await openCase(page, { width, letterQa: { ...V3_REPAIRED_READY, runId: "passing-repair" }, runs: RUNS_REPAIR_PASSED });
      await expect(letter.locator("[data-score-open]")).toHaveText("Ready");
      const modal = await openModal(letter);
      await expect(modal.locator(".jb-score__word")).toHaveText("Ready");
      await expectNoNumbers(modal);
      await shoot(modal.locator(".jb-score__card"), "repaired-draft", width);
      expectHermetic(fence, seen);
    });

    test("GRADE-F G6: the version window shows Original draft and Repaired, each with Preview and Download", async ({ page }) => {
      const { fence, seen, letter } = await openCase(page, { width, letterQa: { ...V3_REPAIRED_READY, runId: "passing-repair" }, runs: RUNS_REPAIR_PASSED });
      await letter.getByRole("button", { name: "Versions" }).click();
      const list = letter.locator(".mat-hist");
      await expect(list.locator(".jb-ver__run")).toHaveCount(2);
      for (const label of ["Original draft", "Repaired"]) {
        const row = list.locator(".jb-ver__run", { hasText: label });
        await expect(row.getByRole("link", { name: "Preview" })).toBeVisible();
        await expect(row.getByRole("link", { name: "Download" })).toBeVisible();
      }
      await expectNoNumbers(list);
      await expectFits(page, list, width);
      await shoot(list, "version-window", width);
      expectHermetic(fence, seen);
    });

    test("GRADE-F G7: a repair that still fails is held, and its download asks in the page", async ({ page }) => {
      const { fence, seen, letter } = await openCase(page, { width, letterQa: { ...V3_REPAIR_STILL_FAILING, runId: "failing-repair-pass-2" }, runs: RUNS_REPAIR_HELD });
      await letter.getByRole("button", { name: "Versions" }).click();
      const list = letter.locator(".mat-hist");
      await expect(list.locator(".jb-ver__run")).toHaveCount(3);
      await expect(list.locator(".jb-ver__run[data-held]")).toHaveCount(2);
      await expect(list.locator(".jb-ver__run[data-default]")).toHaveAttribute("data-run", "previous-good");
      await list.locator('.jb-ver__run[data-run="failing-repair-pass-2"]').getByRole("link", { name: "Download" }).click();
      const confirm = letter.getByRole("alertdialog");
      await expect(confirm).toContainText("This version is held — 1 claim needs a source. Download anyway?");
      await expectNoNumbers(list);
      await expectFits(page, letter, width);
      await shoot(letter, "held", width);
      expectHermetic(fence, seen);
    });

    test("GRADE-F D7: a second review that disagrees reads Needs review, with both verdicts", async ({ page }) => {
      const { fence, seen, letter } = await openCase(page, { width, letterQa: V3_SECOND_DISAGREEMENT });
      await expect(letter.locator("[data-score-open]")).toHaveText("Needs review · Reviewers disagree");
      const modal = await openModal(letter);
      await expect(modal.locator(".jb-score__prov")).toHaveText("First review: writer-example · Second review: judge-example");
      await modal.locator('[data-score-step="reviews"]').click();
      const reviews = modal.locator('[data-step="reviews"]');
      await expect(reviews).toContainText("First review: writer-example — Fails");
      await expect(reviews).toContainText("Second review: judge-example — Ready");
      await expectNoNumbers(modal);
      await shoot(modal.locator(".jb-score__card"), "reviews-disagree", width);
      expectHermetic(fence, seen);
    });
  });
}
