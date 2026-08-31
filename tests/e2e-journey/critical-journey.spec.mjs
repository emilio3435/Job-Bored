/**
 * critical-journey.spec.mjs — JobBored's core user promise in a real browser.
 *
 * The static app and its production browser scripts run unchanged. Every
 * off-origin edge is intercepted below; an unrecognized external request is
 * aborted and fails the owning test.
 */

import { test, expect } from "@playwright/test";
import { copyFileSync, existsSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { startDevServer } from "../../dev-server.mjs";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..");
const CONFIG_PATH = join(REPO_ROOT, "config.js");
const CONFIG_EXAMPLE_PATH = join(REPO_ROOT, "config.example.js");

const SHEET_ID = "journey-sheet-id-1234567890";
const OAUTH_CLIENT_ID = "journey-client.apps.googleusercontent.com";
const DISCOVERY_ORIGIN = "https://journey-worker.test";
const DISCOVERY_WEBHOOK_URL = `${DISCOVERY_ORIGIN}/webhook`;
const MATERIALS_ORIGIN = "http://127.0.0.1:3847";
const RUN_ID = "run-journey-001";
const APPLICATION_SLUG = "acme-platform-engineer";

const PIPELINE_HEADERS = [
  "Date Found",
  "Title",
  "Company",
  "Location",
  "Link",
  "Source",
  "Salary",
  "Fit Score",
  "Priority",
  "Tags",
  "Fit Assessment",
  "Contact",
  "Status",
  "Applied Date",
  "Notes",
  "Follow-up Date",
  "Talking Points",
  "Last contact",
  "Did they reply?",
  "Logo URL",
  "Match Score",
  "Favorite",
  "Dismissed At",
  "Approval Status",
  "Edit Lock",
];

const DISCOVERED_JOB_ROW = [
  "2026-08-30",
  "Platform Engineer",
  "Acme",
  "Remote",
  "https://jobs.acme.test/platform-engineer",
  "Journey worker",
  "$150k–$180k",
  "9",
  "High",
  "Node.js, distributed systems",
  "Strong fit for the candidate's platform background.",
  "",
  "New",
  "",
  "",
  "",
  "Discuss reliability ownership and developer tooling.",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
];

const quietLogger = { log() {}, warn() {}, error() {} };

let server = null;
let baseUrl = "";
let createdConfigJs = false;

function deferred() {
  let resolvePromise;
  const promise = new Promise((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

function corsHeaders() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-headers":
      "authorization, content-type, x-discovery-secret",
    "access-control-allow-methods": "GET, POST, PUT, OPTIONS",
  };
}

async function fulfillJson(route, body, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    headers: corsHeaders(),
    body: JSON.stringify(body),
  });
}

function emptyManifest() {
  return {
    slug: APPLICATION_SLUG,
    company: "Acme",
    title: "Platform Engineer",
    derived: false,
    updatedAt: "",
    documents: [],
  };
}

function pendingManifest() {
  return {
    ...emptyManifest(),
    pending: {
      feature: "cover_letter",
      company: "Acme",
      title: "Platform Engineer",
      jobUrl: "https://jobs.acme.test/platform-engineer",
      requestedAt: "2026-08-30T15:00:00.000Z",
      notes: "Emphasize reliable platforms and developer experience.",
      source: "jobbored-dossier",
      progress: {
        phase: "queued",
        message: "Queued for the drafting worker.",
        attempt: 1,
      },
    },
  };
}

function readyManifest() {
  return {
    ...emptyManifest(),
    updatedAt: "2026-08-30T15:05:00.000Z",
    documents: [
      {
        type: "cover_letter",
        label: "Cover Letter",
        status: "ready",
        primary: "cover-letter.pdf",
        lastModifiedAt: "2026-08-30T15:05:00.000Z",
        files: [
          {
            filename: "cover-letter.pdf",
            format: "pdf",
            size: 293275,
            modifiedAt: "2026-08-30T15:05:00.000Z",
          },
          {
            filename: "cover-letter.html",
            format: "html",
            size: 13478,
            modifiedAt: "2026-08-30T15:05:00.000Z",
          },
        ],
      },
    ],
  };
}

/**
 * Install one catch-all route before navigation. Same-origin static assets are
 * served by the in-process dev server; every off-origin request must match one
 * of the explicit mocks below or it is aborted and recorded as a test failure.
 */
async function installNetworkFence(page, options = {}) {
  const unexpectedExternal = [];
  const statusResponses = options.statusResponses || [];
  const statusGates = statusResponses.map(() => deferred());
  const materialsReadyGate = deferred();
  let statusResponseIndex = 0;
  let pipelineHasJob = options.pipelineStartsWithJob === true;
  let materialsRequestSubmitted = false;
  let pendingManifestDelivered = false;
  let materialsReady = false;
  const appOrigin = new URL(baseUrl).origin;

  await page.route("**/*", async (route) => {
    const request = route.request();
    const method = request.method();
    const url = new URL(request.url());

    if (url.origin === appOrigin) {
      if (url.pathname === "/__proxy/discovery-state") {
        await fulfillJson(route, {
          ok: true,
          recommendation: "ready",
          worker: { up: false, originAllowed: true },
          ngrok: {},
        });
        return;
      }
      if (url.pathname === "/profile") {
        await fulfillJson(route, { ok: false, error: "No profile staged" }, 404);
        return;
      }
      await route.continue();
      return;
    }

    if (method === "OPTIONS") {
      if (
        url.origin === DISCOVERY_ORIGIN ||
        url.origin === MATERIALS_ORIGIN ||
        url.hostname === "sheets.googleapis.com" ||
        url.hostname === "www.googleapis.com"
      ) {
        await route.fulfill({ status: 204, headers: corsHeaders() });
        return;
      }
    }

    if (
      url.hostname === "accounts.google.com" &&
      url.pathname === "/gsi/client"
    ) {
      await route.fulfill({
        status: 200,
        contentType: "application/javascript",
        headers: corsHeaders(),
        body: `window.google = { accounts: { oauth2: {
          initTokenClient: function () { return { requestAccessToken: function () {} }; },
          revoke: function (_token, callback) { if (callback) callback(); }
        } } };`,
      });
      return;
    }

    if (
      url.hostname === "www.googleapis.com" &&
      url.pathname === "/oauth2/v3/userinfo"
    ) {
      await fulfillJson(route, {
        email: "journey@example.test",
        name: "Journey Tester",
      });
      return;
    }

    if (url.hostname === "sheets.googleapis.com") {
      await fulfillJson(route, {
        range: "Pipeline!A:ZZ",
        majorDimension: "ROWS",
        values: pipelineHasJob
          ? [PIPELINE_HEADERS, DISCOVERED_JOB_ROW]
          : [PIPELINE_HEADERS],
      });
      return;
    }

    if (url.hostname === "autocomplete.clearbit.com") {
      await fulfillJson(route, []);
      return;
    }

    if (url.origin === DISCOVERY_ORIGIN && url.pathname === "/webhook") {
      if (method !== "POST") {
        unexpectedExternal.push(`${method} ${url.toString()}`);
        await route.abort("blockedbyclient");
        return;
      }
      await fulfillJson(
        route,
        {
          ok: true,
          status: "accepted",
          runId: RUN_ID,
          statusPath: `/runs/${RUN_ID}`,
          pollAfterMs: 10,
        },
        202,
      );
      return;
    }

    if (
      url.origin === DISCOVERY_ORIGIN &&
      url.pathname === `/runs/${RUN_ID}`
    ) {
      const responseIndex = statusResponseIndex++;
      const response = statusResponses[responseIndex];
      const gate = statusGates[responseIndex];
      if (!response || !gate) {
        unexpectedExternal.push(
          `${method} ${url.toString()} (no lifecycle response queued)`,
        );
        await route.abort("blockedbyclient");
        return;
      }
      await gate.promise;
      if (response.status === "completed") pipelineHasJob = true;
      await fulfillJson(route, response);
      return;
    }

    if (url.origin === MATERIALS_ORIGIN) {
      if (url.pathname === "/api/applications/queue" && method === "GET") {
        const queue = materialsRequestSubmitted && !materialsReady
          ? [
              {
                slug: APPLICATION_SLUG,
                company: "Acme",
                title: "Platform Engineer",
                feature: "cover_letter",
                requestedAt: "2026-08-30T15:00:00.000Z",
                progress: { phase: "queued" },
              },
            ]
          : [];
        await fulfillJson(route, { queue });
        return;
      }

      if (url.pathname === "/api/applications" && method === "GET") {
        await fulfillJson(route, {
          applications: pipelineHasJob
            ? [
                {
                  slug: APPLICATION_SLUG,
                  company: "Acme",
                  title: "Platform Engineer",
                },
              ]
            : [],
        });
        return;
      }

      if (
        url.pathname === `/api/applications/${APPLICATION_SLUG}/manifest` &&
        method === "GET"
      ) {
        if (!materialsRequestSubmitted) {
          await fulfillJson(route, emptyManifest());
          return;
        }
        if (!pendingManifestDelivered) {
          pendingManifestDelivered = true;
          await fulfillJson(route, pendingManifest());
          return;
        }
        await materialsReadyGate.promise;
        materialsReady = true;
        await fulfillJson(route, readyManifest());
        return;
      }

      if (
        url.pathname ===
          `/api/applications/${APPLICATION_SLUG}/job-description` &&
        method === "GET"
      ) {
        await fulfillJson(route, {
          exists: true,
          source: "journey-fixture",
          text: "A deterministic fixture job description.",
        });
        return;
      }

      if (
        url.pathname === `/api/applications/${APPLICATION_SLUG}/request` &&
        method === "POST"
      ) {
        materialsRequestSubmitted = true;
        await fulfillJson(route, { ok: true, slug: APPLICATION_SLUG }, 202);
        return;
      }
    }

    unexpectedExternal.push(`${method} ${url.toString()}`);
    await route.abort("blockedbyclient");
  });

  return {
    unexpectedExternal,
    releaseStatus(responseIndex) {
      statusGates[responseIndex]?.resolve();
    },
    releaseMaterialsReady() {
      materialsReadyGate.resolve();
    },
  };
}

async function stageSignedInBrowserState(page) {
  await page.addInitScript(
    ({ clientId, discoveryWebhookUrl, materialsOrigin, sheetId }) => {
      const expiresAt = Date.now() + 60 * 60 * 1000;
      const grantedOauthScopes = [
        "https://www.googleapis.com/auth/spreadsheets",
        "https://www.googleapis.com/auth/userinfo.email",
        "https://www.googleapis.com/auth/userinfo.profile",
      ].join(" ");
      globalThis.localStorage.setItem(
        "command_center_config_overrides",
        JSON.stringify({
          sheetId,
          oauthClientId: clientId,
          discoveryWebhookUrl,
          discoveryWebhookSecret: "journey-secret",
          jobPostingScrapeUrl: materialsOrigin,
        }),
      );
      globalThis.localStorage.setItem(
        "command_center_oauth_session",
        JSON.stringify({
          expiresAt,
          userEmail: "journey@example.test",
          grantedOauthScopes,
          oauthClientId: clientId,
          hasOauthSession: true,
        }),
      );
      globalThis.sessionStorage.setItem(
        "command_center_oauth_runtime",
        JSON.stringify({
          accessToken: "journey-access-token",
          expiresAt,
          userEmail: "journey@example.test",
          grantedOauthScopes,
          oauthClientId: clientId,
          hasOauthSession: true,
        }),
      );
      globalThis.localStorage.setItem(
        "command_center_discovery_coach_done",
        "1",
      );

      // The production gate function is deliberately replaceable through its
      // module export. Stub it before app-bootstrap's DOMContentLoaded handler,
      // matching the repository's known-good headless signed-in recipe.
      globalThis.document.addEventListener("DOMContentLoaded", () => {
        if (globalThis.JobBoredApp?.setup) {
          globalThis.JobBoredApp.setup.showSheetAccessGate = () => {};
        }
      });
    },
    {
      clientId: OAUTH_CLIENT_ID,
      discoveryWebhookUrl: DISCOVERY_WEBHOOK_URL,
      materialsOrigin: MATERIALS_ORIGIN,
      sheetId: SHEET_ID,
    },
  );
}

async function bootSignedIn(page, fence) {
  await stageSignedInBrowserState(page);
  await page.goto(`${baseUrl}/?jb-v2=1`, { waitUntil: "load" });

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

test.beforeAll(async () => {
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

test("should keep the dashboard behind the login gate when signed out", async ({
  page,
}) => {
  const fence = await installNetworkFence(page);
  await page.goto(`${baseUrl}/?greenfield=1`, { waitUntil: "load" });

  await expect(page.locator("#sheetAccessGateScreen")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Connect Google" })).toBeVisible();
  await expect(page.locator("#dashboard")).toBeHidden();
  expect(fence.unexpectedExternal).toEqual([]);
});

test("should render the dashboard without a sheet-access gate when signed in", async ({
  page,
}) => {
  const fence = await installNetworkFence(page);
  await bootSignedIn(page, fence);

  await expect(
    page.locator('[data-region="pipeline"]'),
  ).toBeVisible();
  expect(fence.unexpectedExternal).toEqual([]);
});

test("should show queued, running, and partial discovery outcomes", async ({
  page,
}) => {
  const fence = await installNetworkFence(page, {
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

  fence.releaseStatus(0);
  await expect(discoveryButton).toHaveAttribute("aria-label", /in progress/);

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
  const fence = await installNetworkFence(page, {
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
  await expect(discoveryButton).toHaveAttribute("aria-label", /in progress/);

  fence.releaseStatus(1);
  await expect(discoveryButton).toHaveAttribute(
    "aria-label",
    /Discovery complete/,
  );

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
