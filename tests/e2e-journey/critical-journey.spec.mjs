/**
 * critical-journey.spec.mjs — JobBored's core user promise in a real browser.
 *
 * The static app and its production browser scripts run unchanged. Every
 * off-origin edge is intercepted by the hermetic fixture harness; an
 * unrecognized external request is aborted and fails the owning test.
 * config.js is never written into the checkout.
 */

import { test, expect } from "@playwright/test";
import {
  DISPOSABLE_AUTH,
  HERMETIC_RUN_ID,
  installHermeticNetworkFence,
  stageSignedInDisposableAuth,
  startHermeticApp,
} from "../e2e-fixtures/hermetic-harness.mjs";

const RUN_ID = HERMETIC_RUN_ID;

let app = null;

test.beforeAll(async () => {
  app = await startHermeticApp();
});

test.afterAll(async () => {
  if (app) await app.close();
});

async function bootSignedIn(page, fence) {
  await stageSignedInDisposableAuth(page, DISPOSABLE_AUTH);
  await page.goto(`${app.baseUrl}/?jb-v2=1`, { waitUntil: "load" });

  // Seed the two user-owned IndexedDB completion flags through the public
  // browser API, then reload so the signed-in journey is not covered by a
  // first-run overlay. This changes test context state only.
  await page.evaluate(async () => {
    await globalThis.CommandCenterUserContent.completeInfraSetup();
    await globalThis.CommandCenterUserContent.completeOnboarding();
  });
  await page.reload({ waitUntil: "load" });

  await expect(page.locator("#dashboard")).toBeVisible();
  await expect(page.locator("#sheetAccessGateScreen")).toBeHidden();
  await expect(page.locator("#authUser")).toBeVisible();
  expect(
    fence.unexpectedExternal,
    "signed-in boot must not escape the explicit network fence",
  ).toEqual([]);
}

async function openDiscoveryAndRun(page) {
  await page.locator("#discoveryBtn").click();
  const drawer = page.locator("#discoveryDrawer");
  await expect(drawer).toBeVisible();
  await drawer.locator("#dpTargetRoles").fill("Platform Engineer");
  await drawer.locator("#discoveryPrefsRun").click();
  await expect(drawer).toBeHidden();
}

test("should keep the dashboard behind the login gate when signed out", async ({
  page,
}) => {
  const fence = await installHermeticNetworkFence(page, { baseUrl: app.baseUrl });
  await page.goto(`${app.baseUrl}/?greenfield=1`, { waitUntil: "load" });

  await expect(page.locator("#sheetAccessGateScreen")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Connect Google" })).toBeVisible();
  await expect(page.locator("#dashboard")).toBeHidden();
  expect(fence.unexpectedExternal).toEqual([]);
});

test("should render the dashboard without a sheet-access gate when signed in", async ({
  page,
}) => {
  const fence = await installHermeticNetworkFence(page, { baseUrl: app.baseUrl });
  await bootSignedIn(page, fence);

  await expect(
    page.locator('[data-region="pipeline"]'),
  ).toBeVisible();
  expect(fence.unexpectedExternal).toEqual([]);
});

test("should show queued, running, and partial discovery outcomes", async ({
  page,
}) => {
  const fence = await installHermeticNetworkFence(page, {
    baseUrl: app.baseUrl,
    runId: RUN_ID,
    statusResponses: [
      {
        runId: RUN_ID,
        status: "running",
        terminal: false,
        message: "Scanning direct company sources.",
        lifecycle: { companyCount: 2 },
        writeResult: { appended: 0, updated: 0 },
      },
      {
        runId: RUN_ID,
        status: "partial",
        terminal: true,
        error: "One source timed out",
        message: "Completed with one unavailable source.",
        lifecycle: { companyCount: 3 },
        writeResult: { appended: 1, updated: 0 },
      },
    ],
  });
  await bootSignedIn(page, fence);
  await openDiscoveryAndRun(page);

  const discoveryButton = page.locator("#discoveryBtn");
  await expect(discoveryButton).toHaveAttribute(
    "aria-label",
    /accepted — checking status/,
  );

  await page.getByRole("button", { name: "Open discovery run history" }).click();
  const runsDialog = page.getByRole("dialog", { name: "Discovery runs" });
  await expect(runsDialog).toBeVisible();

  fence.releaseStatus(0);
  await expect(
    runsDialog.locator('[data-runs-live="job-discovery"]'),
  ).toContainText("Running");
  await runsDialog.getByRole("button", { name: "Close" }).click();

  fence.releaseStatus(1);
  await expect(discoveryButton).toHaveAttribute(
    "aria-label",
    /Discovery finished with partial results.*One source timed out/,
  );
  expect(fence.unexpectedExternal).toEqual([]);
});

test("should carry completed discovery into the pipeline and ready dossier materials", async ({
  page,
}) => {
  const fence = await installHermeticNetworkFence(page, {
    baseUrl: app.baseUrl,
    runId: RUN_ID,
    statusResponses: [
      {
        runId: RUN_ID,
        status: "running",
        terminal: false,
        message: "Scoring matching roles.",
        lifecycle: { companyCount: 2 },
        writeResult: { appended: 0, updated: 0 },
      },
      {
        runId: RUN_ID,
        status: "completed",
        terminal: true,
        message: "Discovery completed.",
        completedAt: "2026-08-30T14:30:00.000Z",
        lifecycle: { companyCount: 3 },
        writeResult: { appended: 1, updated: 0 },
      },
    ],
  });
  await bootSignedIn(page, fence);
  await expect(page.locator(".pipe-sticker")).toHaveCount(0);

  await openDiscoveryAndRun(page);
  const discoveryButton = page.locator("#discoveryBtn");
  await expect(discoveryButton).toHaveAttribute(
    "aria-label",
    /accepted — checking status/,
  );

  fence.releaseStatus(0);
  fence.releaseStatus(1);
  await expect(discoveryButton).toHaveAttribute(
    "aria-label",
    /Discovery complete/,
  );

  const discoveredColumn = page.getByRole("region", {
    name: "Discovered column",
  });
  await expect(discoveredColumn).toContainText("Discovered 1");
  await discoveredColumn.getByRole("button", { name: "Expand Discovered" }).click();

  const discoveredJob = page.locator(".pipe-sticker", {
    hasText: "Platform Engineer",
  });
  await expect(discoveredJob).toContainText("Acme");
  await expect(discoveredJob).toBeVisible();
  await discoveredJob.click();

  const dossier = page.locator('[data-region="role"]');
  await expect(
    dossier.getByRole("button", { name: "Draft a cover letter for this role" }),
  ).toBeVisible();
  await dossier
    .getByRole("button", { name: "Draft a cover letter for this role" })
    .click();

  const notesForm = dossier.getByRole("form", {
    name: "Notes for the cover letter",
  });
  await expect(notesForm).toBeVisible();
  await notesForm
    .getByRole("textbox")
    .fill("Emphasize reliable platforms and developer experience.");
  await notesForm.getByRole("button", { name: "Start draft" }).click();

  await expect(dossier.getByText("WAITING IN QUEUE", { exact: true })).toBeVisible();
  await expect(dossier.getByText("Queued for the drafting worker.")).toBeVisible();

  fence.releaseMaterialsReady();
  const materialsSection = dossier.locator(".brief-materials");
  await expect(
    materialsSection.getByText("Cover Letter", { exact: true }),
  ).toBeVisible();
  await expect(materialsSection.getByText("Ready", { exact: true })).toBeVisible();
  await expect(materialsSection.getByRole("link", { name: "Preview" })).toBeVisible();
  await expect(materialsSection.locator(".brief-materials__progress")).toHaveCount(0);

  expect(fence.unexpectedExternal).toEqual([]);
});
