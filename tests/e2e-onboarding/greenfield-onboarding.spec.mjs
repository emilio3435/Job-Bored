/**
 * Hermetic greenfield onboarding proof.
 *
 * The browser drives only visible controls. Google Identity Services,
 * userinfo, Sheets, and the selected free provider are replaced at their
 * script/network boundaries; application functions and browser persistence
 * remain real.
 */
import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { startDevServer } from "../../dev-server.mjs";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..");
const CONFIG_EXAMPLE_SOURCE = readFileSync(
  resolve(REPO_ROOT, "config.example.js"),
  "utf8",
);

const CLIENT_ID = "jobbored-onboarding-e2e.apps.googleusercontent.com";
const ACCESS_TOKEN = "jobbored-onboarding-e2e-token";
const OPENROUTER_KEY = "sk-or-jobbored-onboarding-e2e";
const SHEET_ID = "jobboredOnboardingE2ESheet1234567890";
const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
];
const STARTER_HEADERS = [
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

const GIS_STUB_SOURCE = `
(() => {
  const state = { init: null, requests: [], revoked: [] };
  window.__JOBBORED_E2E_GIS__ = state;
  window.google = {
    accounts: {
      oauth2: {
        initTokenClient(options) {
          state.init = {
            clientId: options.client_id,
            scope: options.scope,
            includeGrantedScopes: options.include_granted_scopes,
          };
          return {
            requestAccessToken(request = {}) {
              state.requests.push({ ...request });
              window.setTimeout(() => options.callback({
                access_token: ${JSON.stringify(ACCESS_TOKEN)},
                expires_in: 3600,
                scope: ${JSON.stringify(GOOGLE_SCOPES.join(" "))},
              }), 0);
            },
          };
        },
        revoke(token, callback) {
          state.revoked.push(token);
          window.setTimeout(() => callback && callback(), 0);
        },
      },
    },
  };
})();
`;

const quietLogger = { log() {}, warn() {}, error() {} };
let server;
let baseUrl;

test.beforeAll(async () => {
  server = await startDevServer({ port: 0, logger: quietLogger });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.afterAll(async () => {
  if (server) await new Promise((done) => server.close(done));
});

function jsonHeaders() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, PUT, OPTIONS",
    "access-control-allow-headers": "authorization, content-type",
    "content-type": "application/json",
  };
}

async function fulfillJson(route, body, status = 200) {
  await route.fulfill({
    status,
    headers: jsonHeaders(),
    body: JSON.stringify(body),
  });
}

function captureBrowserErrors(page) {
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => {
    errors.push(`pageerror: ${error.message}`);
  });
  return errors;
}

async function installHermeticBoundaries(page) {
  const calls = {
    userinfo: [],
    sheetsCreate: [],
    sheetsHeaders: [],
    sheetsReads: [],
    openrouterModels: [],
    ollamaModels: [],
    violations: [],
    unexpectedExternal: [],
  };
  const context = page.context();

  await context.route("**/*", async (route) => {
    const request = route.request();
    const method = request.method();
    const url = new URL(request.url());
    const auth = request.headers().authorization || "";

    if (url.origin === baseUrl && url.pathname === "/config.js") {
      await route.fulfill({
        status: 200,
        contentType: "application/javascript",
        body: CONFIG_EXAMPLE_SOURCE,
      });
      return;
    }

    if (
      url.origin === "https://accounts.google.com" &&
      url.pathname === "/gsi/client"
    ) {
      await route.fulfill({
        status: 200,
        contentType: "application/javascript",
        body: GIS_STUB_SOURCE,
      });
      return;
    }

    if (url.origin === baseUrl && url.pathname === "/discovery-local-bootstrap.json") {
      await fulfillJson(route, {});
      return;
    }

    if (url.origin === baseUrl && url.pathname.startsWith("/__proxy/")) {
      await fulfillJson(route, {
        ok: false,
        recommendation: "needs_human",
        reason: "e2e_not_configured",
        worker: { up: false },
        ngrok: { url: "" },
      });
      return;
    }

    if (
      url.origin === "http://127.0.0.1:3847" ||
      url.origin === "http://localhost:3847"
    ) {
      await fulfillJson(route, { ok: true, applications: [], queue: [] });
      return;
    }

    if (
      method === "GET" &&
      url.origin === "http://127.0.0.1:11434" &&
      url.pathname === "/v1/models" &&
      url.search === ""
    ) {
      calls.ollamaModels.push({ method, auth });
      if (auth) calls.violations.push("unexpected Ollama authorization");
      await fulfillJson(route, { data: [{ id: "gemma4:e2b" }] });
      return;
    }

    if (
      url.origin === "https://www.googleapis.com" &&
      url.pathname === "/oauth2/v3/userinfo"
    ) {
      if (method === "OPTIONS") {
        await route.fulfill({ status: 204, headers: jsonHeaders() });
        return;
      }
      calls.userinfo.push({ method, auth });
      if (method !== "GET") calls.violations.push(`userinfo method ${method}`);
      if (auth !== `Bearer ${ACCESS_TOKEN}`) {
        calls.violations.push(`userinfo authorization ${auth || "missing"}`);
      }
      await fulfillJson(route, { email: "qa@jobbored.example" });
      return;
    }

    if (url.origin === "https://sheets.googleapis.com") {
      if (method === "OPTIONS") {
        await route.fulfill({ status: 204, headers: jsonHeaders() });
        return;
      }
      if (auth !== `Bearer ${ACCESS_TOKEN}`) {
        calls.violations.push(`Sheets authorization ${auth || "missing"}`);
      }
      if (method === "POST" && url.pathname === "/v4/spreadsheets") {
        const violationCount = calls.violations.length;
        const body = request.postDataJSON();
        calls.sheetsCreate.push(body);
        if (!String(body?.properties?.title || "").startsWith("JobBored Pipeline ")) {
          calls.violations.push("starter Sheet title");
        }
        if (body?.sheets?.[0]?.properties?.title !== "Pipeline") {
          calls.violations.push("starter Sheet Pipeline tab");
        }
        const gridProperties = body?.sheets?.[0]?.properties?.gridProperties;
        if (
          JSON.stringify(gridProperties) !==
          JSON.stringify({
            rowCount: 200,
            columnCount: STARTER_HEADERS.length,
            frozenRowCount: 1,
          })
        ) {
          calls.violations.push("starter Sheet gridProperties");
        }
        if (calls.violations.length !== violationCount) {
          await fulfillJson(route, { error: { message: "invalid starter Sheet" } }, 418);
          return;
        }
        await fulfillJson(route, { spreadsheetId: SHEET_ID, spreadsheetUrl: "" });
        return;
      }
      if (method === "PUT" && url.pathname.includes(`/spreadsheets/${SHEET_ID}/values/`)) {
        const violationCount = calls.violations.length;
        const encodedRange = url.pathname.split("/values/")[1] || "";
        const range = decodeURIComponent(encodedRange);
        const body = request.postDataJSON();
        calls.sheetsHeaders.push(body);
        if (range !== "Pipeline!A1:Y1") {
          calls.violations.push(`starter header URL range ${range || "missing"}`);
        }
        if (url.searchParams.get("valueInputOption") !== "RAW") {
          calls.violations.push("starter header valueInputOption");
        }
        if (body?.range !== "Pipeline!A1:Y1") {
          calls.violations.push(`starter header range ${body?.range || "missing"}`);
        }
        if (JSON.stringify(body?.values?.[0]) !== JSON.stringify(STARTER_HEADERS)) {
          calls.violations.push("starter header values");
        }
        if (body?.majorDimension !== "ROWS") {
          calls.violations.push("starter header majorDimension");
        }
        if (calls.violations.length !== violationCount) {
          await fulfillJson(route, { error: { message: "invalid starter headers" } }, 418);
          return;
        }
        await fulfillJson(route, {
          updatedRange: "Pipeline!A1:Y1",
          updatedRows: 1,
          updatedColumns: STARTER_HEADERS.length,
          updatedCells: STARTER_HEADERS.length,
        });
        return;
      }
      if (method === "GET" && url.pathname.includes(`/spreadsheets/${SHEET_ID}/values/`)) {
        const encodedRange = url.pathname.split("/values/")[1] || "";
        const range = decodeURIComponent(encodedRange);
        calls.sheetsReads.push(range);
        if (range !== "Pipeline!A:ZZ") {
          calls.violations.push(`unexpected Sheets read range ${range || "missing"}`);
          await fulfillJson(route, { error: { message: "unexpected e2e range" } }, 418);
          return;
        }
        await fulfillJson(route, {
          range,
          majorDimension: "ROWS",
          values: [STARTER_HEADERS],
        });
        return;
      }
      calls.violations.push(`unexpected Sheets request ${method} ${url.href}`);
      await fulfillJson(route, { error: { message: "unexpected e2e request" } }, 418);
      return;
    }

    if (
      url.origin === "https://openrouter.ai" &&
      url.pathname === "/api/v1/models"
    ) {
      if (method === "OPTIONS") {
        await route.fulfill({ status: 204, headers: jsonHeaders() });
        return;
      }
      calls.openrouterModels.push({ method, auth });
      if (method !== "GET") calls.violations.push(`OpenRouter method ${method}`);
      if (auth !== `Bearer ${OPENROUTER_KEY}`) {
        calls.violations.push(`OpenRouter authorization ${auth || "missing"}`);
      }
      await fulfillJson(route, {
        data: [{ id: "openai/gpt-oss-120b:free", name: "E2E free model" }],
      });
      return;
    }

    if (url.origin !== baseUrl) {
      calls.unexpectedExternal.push(`${method} ${url.href}`);
      await fulfillJson(route, { error: "unexpected external request" }, 418);
      return;
    }

    await route.continue();
  });

  return calls;
}

async function expectLoginGate(page) {
  await expect(page.getByRole("heading", { name: "Connect Google" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Google OAuth Client ID" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
  await expect(page.locator("#firstRunWizard")).toBeHidden();
}

async function bootGreenfield(page, { useUrlReset = false } = {}) {
  const errors = captureBrowserErrors(page);
  const calls = await installHermeticBoundaries(page);

  if (useUrlReset) {
    await page.goto(`${baseUrl}/?greenfield=1`, { waitUntil: "load" });
    await expect(page).toHaveURL(`${baseUrl}/?greenfield=1`);
    await expectLoginGate(page);
    // ?greenfield=1 clears config and IndexedDB on every load. Leave it before
    // creating any state so the later persistence navigation cannot erase it.
    await page.goto(`${baseUrl}/`, { waitUntil: "load" });
    await expect(page).toHaveURL(`${baseUrl}/`);
  } else {
    await page.goto(`${baseUrl}/`, { waitUntil: "load" });
  }
  await expectLoginGate(page);

  return {
    calls,
    errors,
    // The explicit URL reset arms production's one-shot consent request.
    // A naturally fresh context uses the normal empty interactive request.
    expectedInteractiveRequest: useUrlReset ? { prompt: "consent" } : {},
  };
}

async function connectGoogle(page, expectedInteractiveRequest) {
  const clientId = page.getByRole("textbox", { name: "Google OAuth Client ID" });
  const reloaded = page.waitForNavigation({ waitUntil: "load" });
  await clientId.fill(CLIENT_ID);
  await reloaded;

  const signIn = page.getByRole("button", { name: "Log in with Google" });
  await expect(signIn).toBeVisible();
  await signIn.click();

  const wizard = page.getByRole("dialog", { name: "Set up JobBored" });
  await expect(wizard).toBeVisible();
  await expect(wizard.getByRole("heading", { name: "Connect your Google Sheet" })).toBeVisible();
  await expect(wizard.getByText("Step 1 of 2", { exact: true })).toBeVisible();
  await expect(wizard.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "1");
  const createSheet = wizard.getByRole("button", { name: "Create a starter sheet" });
  await expect(createSheet).toBeEnabled();
  await expect(createSheet).toBeFocused();

  const gis = await page.evaluate(() => globalThis.__JOBBORED_E2E_GIS__);
  expect(gis.init.clientId).toBe(CLIENT_ID);
  expect(gis.init.scope.split(/\s+/).sort()).toEqual([...GOOGLE_SCOPES].sort());
  expect(gis.init.includeGrantedScopes).toBe(true);
  expect(gis.requests).toEqual([expectedInteractiveRequest]);
  expect(gis.requests).not.toContainEqual({ prompt: "none" });
}

async function reachProfileOnboarding(page, options) {
  const state = await bootGreenfield(page, options);
  await connectGoogle(page, state.expectedInteractiveRequest);
  await expect.poll(() => state.calls.userinfo.length).toBe(1);

  const firstRun = page.getByRole("dialog", { name: "Set up JobBored" });
  await firstRun.getByRole("button", { name: "Create a starter sheet" }).click();

  await expect(firstRun.getByRole("heading", { name: "Choose your AI provider" })).toBeVisible();
  await expect(firstRun.getByText("Step 2 of 2", { exact: true })).toBeVisible();
  await expect(firstRun.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "2");
  await expect.poll(() => state.calls.sheetsCreate.length).toBe(1);
  await expect.poll(() => state.calls.sheetsHeaders.length).toBe(1);

  const freeProvider = firstRun.getByRole("radio", { name: /OpenRouter — free/ });
  await expect(freeProvider).toBeChecked();
  const finish = firstRun.getByRole("button", { name: "Finish setup" });
  await expect(finish).toBeDisabled();

  await firstRun.getByLabel("Paste a free OpenRouter key").fill(OPENROUTER_KEY);
  await firstRun.getByRole("button", { name: "Save key" }).click();
  await expect(firstRun.getByText("Key saved.", { exact: true })).toBeVisible();
  await expect(finish).toBeEnabled();
  await expect.poll(() => state.calls.openrouterModels.length).toBeGreaterThan(0);

  await finish.click();
  const celebration = page.getByRole("dialog", { name: "Workspace connected!" });
  await expect(celebration).toBeVisible();
  const buildProfile = celebration.getByRole("button", { name: /Build your profile/ });
  await expect(buildProfile).toBeFocused();
  await buildProfile.click();

  const profile = page.getByRole("dialog", { name: "Resume" });
  await expect(profile).toBeVisible();
  await expect(profile.getByText("Step 1 of 4", { exact: true })).toBeVisible();
  await expect(page.locator("#firstRunWizard")).toBeHidden();
  return state;
}

function expectCleanRun(state) {
  expect(state.calls.violations, "network boundary contract violations").toEqual([]);
  expect(state.calls.unexpectedExternal, "unexpected external requests").toEqual([]);
  expect(state.errors, "browser console/page errors").toEqual([]);
}

test("VAL-WIZ-001: login gate sign-in opens the first-run wizard", async ({ page }) => {
  const state = await bootGreenfield(page);
  await connectGoogle(page, state.expectedInteractiveRequest);
  await expect.poll(() => state.calls.userinfo.length).toBe(1);
  expectCleanRun(state);
});

test("VAL-WIZ-002: Sheet and provider steps hand off to profile onboarding", async ({ page }) => {
  const state = await reachProfileOnboarding(page);
  expect(state.calls.sheetsCreate).toHaveLength(1);
  expect(state.calls.sheetsHeaders).toHaveLength(1);
  expectCleanRun(state);
});

test("VAL-WIZ-003: completion survives a clean-URL reload and Settings reopens setup", async ({ page }) => {
  const state = await reachProfileOnboarding(page, { useUrlReset: true });

  expect(new URL(page.url()).search).toBe("");
  await page.goto(`${baseUrl}/`, { waitUntil: "load" });
  await expect(page).toHaveURL(`${baseUrl}/`);
  const profile = page.getByRole("dialog", { name: "Resume" });
  await expect(profile).toBeVisible();
  await expect(page.locator("#firstRunWizard")).toBeHidden();
  await expect.poll(() => state.calls.sheetsReads).toContain("Pipeline!A:ZZ");

  // The current profile wizard has no close button; its production keyboard
  // dismissal is the user-facing close path and releases the inert dashboard.
  await page.keyboard.press("Escape");
  await expect(profile).toBeHidden();
  await expect(page.locator("#dashboard")).toBeVisible();
  await page.getByRole("button", { name: "Settings and setup" }).click();

  const settings = page.getByRole("dialog", { name: "JobBored settings" });
  await expect(settings).toBeVisible();
  await expect.poll(() => state.calls.ollamaModels.length).toBeGreaterThan(0);
  const runAgain = settings.getByRole("button", { name: "Run setup again" });
  await expect(runAgain).toBeVisible();

  let confirmation = "";
  page.once("dialog", async (dialog) => {
    confirmation = dialog.message();
    await dialog.accept();
  });
  await runAgain.click();
  expect(confirmation).toBe(
    "Run the setup wizard again? Your connected Sheet, keys, and provider choice stay saved.",
  );

  const firstRun = page.getByRole("dialog", { name: "Set up JobBored" });
  await expect(firstRun).toBeVisible();
  await expect(firstRun.getByText("Step 1 of 2", { exact: true })).toBeVisible();
  await expect(firstRun.getByText("✓ Sheet connected", { exact: true })).toBeVisible();
  const continueButton = firstRun.getByRole("button", { name: "Continue" });
  await expect(continueButton).toBeEnabled();
  await continueButton.click();
  await expect(firstRun.getByRole("radio", { name: /OpenRouter — free/ })).toBeChecked();
  await expect(firstRun.getByLabel("Paste a free OpenRouter key")).toHaveValue(
    OPENROUTER_KEY,
  );

  expectCleanRun(state);
});
