/**
 * Hermetic Playwright fixture harness (F4-D).
 *
 * Browser suites must run without real Google, Sheets, or checkout dirt.
 * This module:
 *   - starts the dashboard on loopback
 *   - serves config.example.js as /config.js (never writes config.js)
 *   - intercepts Google/Sheets/fonts/GSI and the local materials API
 *   - stages disposable signed-in storage (no live OAuth)
 *   - exports 320/375/393 phone geometry for F3-D
 *
 * Real OAuth, Sheets mutations, and paid providers stay closed.
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { startDevServer } from "../../dev-server.mjs";

export const REPO_ROOT = resolve(import.meta.dirname, "..", "..");

export const PHONE_VIEWPORTS = [
  { name: "compact-320", width: 320, height: 568 },
  { name: "iphone-375", width: 375, height: 667 },
  { name: "iphone-393", width: 393, height: 852 },
];

export const DISPOSABLE_AUTH = {
  sheetId: "hermetic-sheet-id-1234567890",
  oauthClientId: "hermetic-client.apps.googleusercontent.com",
  userEmail: "hermetic@example.test",
  accessToken: "hermetic-access-token",
  // workers.dev is in the dashboard CSP connect-src; the fence intercepts it.
  discoveryOrigin: "https://hermetic-worker.workers.dev",
  discoveryWebhookUrl: "https://hermetic-worker.workers.dev/webhook",
  discoveryWebhookSecret: "hermetic-secret",
  materialsOrigin: "http://127.0.0.1:3847",
};

export const PIPELINE_HEADERS = [
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

export const DISCOVERED_JOB_ROW = [
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

const APPLICATION_SLUG = "acme-platform-engineer";
const RUN_ID = "run-hermetic-001";

const quietLogger = { log() {}, warn() {}, error() {} };

export function deferred() {
  let resolvePromise;
  const promise = new Promise((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

export function corsHeaders() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-headers":
      "authorization, content-type, x-discovery-secret",
    "access-control-allow-methods": "GET, POST, PUT, OPTIONS",
  };
}

export async function fulfillJson(route, body, status = 200) {
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

export function gsiStubScript() {
  return `window.google = { accounts: { oauth2: {
    initTokenClient: function () { return { requestAccessToken: function () {} }; },
    revoke: function (_token, callback) { if (callback) callback(); }
  } } };`;
}

export function hermeticConfigJs() {
  return readFileSync(join(REPO_ROOT, "config.example.js"), "utf8");
}

export async function startHermeticApp({ logger = quietLogger } = {}) {
  const server = await startDevServer({ port: 0, logger });
  return {
    server,
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    repoRoot: REPO_ROOT,
    async close() {
      await new Promise((done) => server.close(done));
    },
  };
}

/**
 * Install one catch-all route before navigation. Same-origin static assets
 * continue to the in-process server except /config.js, which is always the
 * example file. Every off-origin request must match an explicit mock or it
 * is aborted and recorded.
 */
export async function installHermeticNetworkFence(page, options = {}) {
  const baseUrl = options.baseUrl;
  if (!baseUrl) throw new Error("installHermeticNetworkFence requires baseUrl");
  const auth = { ...DISPOSABLE_AUTH, ...(options.auth || {}) };
  const discoveryOrigin = auth.discoveryOrigin;
  const materialsOrigin = auth.materialsOrigin;
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
  const configJs = hermeticConfigJs();

  await page.route("**/*", async (route) => {
    const request = route.request();
    const method = request.method();
    const url = new URL(request.url());

    if (url.origin === appOrigin) {
      if (url.pathname === "/config.js") {
        await route.fulfill({
          status: 200,
          contentType: "application/javascript",
          body: configJs,
        });
        return;
      }
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
        url.origin === discoveryOrigin ||
        url.origin === materialsOrigin ||
        url.hostname === "sheets.googleapis.com" ||
        url.hostname === "www.googleapis.com" ||
        url.hostname === "accounts.google.com"
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
        body: gsiStubScript(),
      });
      return;
    }

    if (
      url.hostname === "fonts.googleapis.com" ||
      url.hostname === "fonts.gstatic.com"
    ) {
      await route.fulfill({
        status: 200,
        contentType: url.pathname.endsWith(".css")
          ? "text/css"
          : "application/octet-stream",
        body: "",
      });
      return;
    }

    if (
      url.hostname === "www.googleapis.com" &&
      url.pathname === "/oauth2/v3/userinfo"
    ) {
      await fulfillJson(route, {
        email: auth.userEmail,
        name: "Hermetic Tester",
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

    if (url.origin === discoveryOrigin && url.pathname === "/webhook") {
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
          runId: options.runId || RUN_ID,
          statusPath: `/runs/${options.runId || RUN_ID}`,
          pollAfterMs: 10,
        },
        202,
      );
      return;
    }

    const runId = options.runId || RUN_ID;
    if (url.origin === discoveryOrigin && url.pathname === `/runs/${runId}`) {
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

    if (
      (url.hostname === "127.0.0.1" || url.hostname === "localhost") &&
      url.port === "8644"
    ) {
      if (url.pathname === "/health") {
        await fulfillJson(route, {
          status: "ok",
          service: "browser-use-discovery-worker",
        });
        return;
      }
      await fulfillJson(route, { ok: true, status: "ok", mode: "hermetic" });
      return;
    }

    if (url.origin === materialsOrigin) {
      if (url.pathname === "/api/applications/queue" && method === "GET") {
        const queue =
          materialsRequestSubmitted && !materialsReady
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
          source: "hermetic-fixture",
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

      await fulfillJson(route, { ok: true, applications: [], queue: [] });
      return;
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

export async function stageSignedInDisposableAuth(page, auth = DISPOSABLE_AUTH) {
  await page.addInitScript(
    ({ clientId, discoveryWebhookUrl, materialsOrigin, sheetId, userEmail, accessToken }) => {
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
          discoveryWebhookSecret: "hermetic-secret",
          jobPostingScrapeUrl: materialsOrigin,
        }),
      );
      globalThis.localStorage.setItem(
        "command_center_oauth_session",
        JSON.stringify({
          expiresAt,
          userEmail,
          grantedOauthScopes,
          oauthClientId: clientId,
          hasOauthSession: true,
        }),
      );
      globalThis.sessionStorage.setItem(
        "command_center_oauth_runtime",
        JSON.stringify({
          accessToken,
          expiresAt,
          userEmail,
          grantedOauthScopes,
          oauthClientId: clientId,
          hasOauthSession: true,
        }),
      );
      globalThis.localStorage.setItem(
        "command_center_discovery_coach_done",
        "1",
      );

      globalThis.document.addEventListener("DOMContentLoaded", () => {
        if (globalThis.JobBoredApp?.setup) {
          globalThis.JobBoredApp.setup.showSheetAccessGate = () => {};
        }
      });
    },
    {
      clientId: auth.oauthClientId,
      discoveryWebhookUrl: auth.discoveryWebhookUrl,
      materialsOrigin: auth.materialsOrigin,
      sheetId: auth.sheetId,
      userEmail: auth.userEmail,
      accessToken: auth.accessToken,
    },
  );
}

export const HERMETIC_RUN_ID = RUN_ID;
export const HERMETIC_APPLICATION_SLUG = APPLICATION_SLUG;
