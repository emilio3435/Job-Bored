/**
 * grade-versions.spec.mjs — GRADE lane W-FE, the journey step for G6/G7.
 *
 * A repaired draft lists both of its versions in the version window —
 * "Original draft" (Fails, held) and "Repaired" (Ready, the default) — and
 * both download: the default straight away, the held one only after the
 * in-page confirm (never window.confirm).
 *
 * Hermetic: tests/e2e-fixtures/hermetic-harness.mjs fences Google and the
 * host paths; installGradeMaterialsApi answers the materials routes from
 * W-BE's frozen fixtures (tests/fixtures/materials-qa-v3.mjs) and refuses
 * the rest. No live port, no model call.
 */

/* page.evaluate callbacks run in the browser. */
/* global window */
import { test, expect } from "@playwright/test";
import {
  installGradeMaterialsApi,
  installHermeticNetworkFence,
  startHermeticApp,
} from "../e2e-fixtures/hermetic-harness.mjs";
import { RUNS_REPAIR_PASSED, V3_READY, V3_REPAIRED_READY } from "../fixtures/materials-qa-v3.mjs";

const SLUG = "acme-robotics-dispatch-analyst";
const SECTION = '[data-region="role"] .brief-materials--rows';
const FILE = (name) => ({ filename: name, format: name.split(".").pop(), size: 2048, modifiedAt: "2026-10-02T09:00:00.000Z" });

let app = null;
test.beforeAll(async () => { app = await startHermeticApp(); });
test.afterAll(async () => { if (app) await app.close(); });

function manifest() {
  const doc = (type, stem) => ({
    type, label: type === "resume" ? "Tailored Resume" : "Cover Letter", status: "ready", primary: `${stem}.pdf`,
    lastModifiedAt: "2026-10-02T09:00:00.000Z", files: [FILE(`${stem}.pdf`), FILE(`${stem}.html`)], text: FILE(`${stem}.txt`), exports: {},
  });
  return {
    slug: SLUG, company: "Acme Robotics", title: "Dispatch analyst", derived: false, updatedAt: "2026-10-02T09:10:00.000Z",
    runId: "passing-repair", documents: [doc("resume", "resume"), doc("cover_letter", "cover-letter")],
    quality: { documents: {
      resume: { status: "pass", issues: [], qa: { ...V3_READY, document: "resume", runId: "passing-repair" } },
      cover_letter: { status: "pass", issues: [], qa: { ...V3_REPAIRED_READY, runId: "passing-repair" } },
    } },
  };
}

async function openCase(page) {
  await page.setViewportSize({ width: 1440, height: 1100 });
  const fence = await installHermeticNetworkFence(page, { baseUrl: app.baseUrl });
  const seen = await installGradeMaterialsApi(page, { slug: SLUG, manifest, runs: () => RUNS_REPAIR_PASSED });
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
  return { fence, seen, section };
}

test("GRADE-F G6: the version window lists a repaired draft's Original draft and Repaired, and both download", async ({ page }) => {
  let confirmed = 0;
  page.on("dialog", async (d) => { confirmed += 1; await d.dismiss(); });
  const { fence, seen, section } = await openCase(page);
  const letter = section.locator('[data-doc="cover_letter"]');
  await expect(letter.locator("[data-score-open]")).toHaveText("Ready");

  await letter.getByRole("button", { name: "Versions" }).click();
  const runs = letter.locator(".mat-hist .jb-ver__run");
  await expect(runs).toHaveCount(2);
  const original = runs.filter({ hasText: "Original draft" });
  const repaired = runs.filter({ hasText: "Repaired" });
  await expect(original).toContainText("Fails");
  await expect(original).toContainText("Held — 1 claim needs a source");
  await expect(repaired).toContainText("Ready");
  await expect(repaired).toContainText("Default");

  /* The default downloads straight away, from its own run. */
  const first = page.waitForEvent("download");
  await repaired.getByRole("link", { name: "Download" }).click();
  expect((await first).suggestedFilename()).toBe("cover-letter.pdf");

  /* The held one asks in the page first. */
  await original.getByRole("link", { name: "Download" }).click();
  const confirm = letter.getByRole("alertdialog");
  await expect(confirm).toHaveAttribute("data-gate", "held");
  await expect(confirm).toContainText("This version is held — 1 claim needs a source. Download anyway?");
  const second = page.waitForEvent("download");
  await confirm.getByRole("button", { name: "Download anyway" }).click();
  expect((await second).suggestedFilename()).toBe("cover-letter.pdf");

  expect(seen.files.filter((f) => f.download).map((f) => f.runId)).toEqual(["passing-repair", "passing-repair-pass-1"]);
  expect(confirmed, "window.confirm never ran").toBe(0);
  expect(fence.unexpectedExternal).toEqual([]);
  expect(seen.refused).toEqual([]);
  expect(app.hostRequests).toEqual([]);
});
