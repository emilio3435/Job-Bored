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
const SERPAPI_KEY = "jobbored-onboarding-e2e-serpapi-key";
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
const STARTER_PROFILE = {
  version: 1,
  identity: {
    targetRoles: ["Staff Engineer", "Platform Engineer"],
    targetSeniority: "ic_staff",
    primaryNarrative:
      "I build reliable distributed systems and lead high-leverage platform work.",
  },
  strengths: [
    { name: "Distributed systems", rank: 1 },
    { name: "Technical leadership", rank: 2 },
  ],
  wants: ["Hands-on building"],
  avoids: ["Quota sales"],
  hardConstraints: {
    workMode: "any",
    workAuth: "us_authorized",
    salaryFloor: 180000,
    salaryRequired: false,
  },
};
const AUTH = Object.freeze({
  clientId: CLIENT_ID,
  accessToken: ACCESS_TOKEN,
  sheetId: SHEET_ID,
  userEmail: "qa@jobbored.example",
});

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
    openrouterChecks: [],
    llmConfigPins: [],
    profileTemplates: [],
    profileWrites: [],
    serpApiChecks: [],
    discoveryEnvWrites: [],
    discoveryBoots: [],
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

    if (
      url.origin === baseUrl &&
      method === "POST" &&
      url.pathname === "/profile/template/engineer"
    ) {
      calls.profileTemplates.push({ method, path: url.pathname });
      await fulfillJson(route, { ok: true, template: STARTER_PROFILE });
      return;
    }

    if (url.origin === baseUrl && method === "POST" && url.pathname === "/profile") {
      calls.profileWrites.push(request.postDataJSON());
      await fulfillJson(route, { ok: true, updatedAt: "2026-09-02T00:00:00Z" });
      return;
    }

    if (url.origin === baseUrl && url.pathname === "/__proxy/serpapi-check") {
      const body = request.postDataJSON();
      calls.serpApiChecks.push(body);
      if (method !== "POST") calls.violations.push(`SerpApi check method ${method}`);
      if (body?.key !== SERPAPI_KEY) calls.violations.push("SerpApi check key");
      await fulfillJson(route, { ok: true, plan: "Free", searchesLeft: 99 });
      return;
    }

    if (url.origin === baseUrl && url.pathname === "/__proxy/discovery-env-key") {
      const body = request.postDataJSON();
      calls.discoveryEnvWrites.push(body);
      if (method !== "POST") calls.violations.push(`discovery env method ${method}`);
      if (body?.key !== "SERPAPI_API_KEY" || body?.value !== SERPAPI_KEY) {
        calls.violations.push("discovery env SerpApi payload");
      }
      await fulfillJson(route, { ok: true });
      return;
    }

    if (url.origin === baseUrl && url.pathname === "/__proxy/full-boot") {
      calls.discoveryBoots.push({ method, search: url.search });
      if (method !== "POST") calls.violations.push(`discovery boot method ${method}`);
      await fulfillJson(route, { ok: true, state: "ready" });
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
      if (method === "POST" && url.pathname === "/api/llm-config") {
        calls.llmConfigPins.push(request.postDataJSON());
        await fulfillJson(route, { ok: true });
        return;
      }
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
      url.pathname === "/api/v1/chat/completions"
    ) {
      if (method === "OPTIONS") {
        await route.fulfill({ status: 204, headers: jsonHeaders() });
        return;
      }
      const body = request.postDataJSON();
      calls.openrouterChecks.push({ method, auth, body });
      if (method !== "POST") calls.violations.push(`OpenRouter check method ${method}`);
      if (auth !== `Bearer ${OPENROUTER_KEY}`) {
        calls.violations.push(`OpenRouter check authorization ${auth || "missing"}`);
      }
      if (body?.model !== "openai/gpt-oss-120b:free") {
        calls.violations.push(`OpenRouter check model ${body?.model || "missing"}`);
      }
      await fulfillJson(route, {
        choices: [{ message: { content: "ok" } }],
      });
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

function beat(page, id) {
  return page.locator(`#oneFlowMount .oneflow-beat[data-beat-id="${id}"]`);
}

async function bootGreenfield(page) {
  const errors = captureBrowserErrors(page);
  const calls = await installHermeticBoundaries(page);

  await page.goto(`${baseUrl}/?greenfield=1`, { waitUntil: "load" });
  await page.waitForFunction(
    () =>
      typeof globalThis.JobBoredOneFlow?.open === "function" &&
      globalThis.JobBoredOneFlowDemoBoard?.isActive() === true,
  );
  await expect(page).toHaveURL(`${baseUrl}/`);

  const setupCard = page.getByRole("region", { name: "Set up JobBored" });
  await expect(setupCard).toBeVisible();
  await expect(
    setupCard.getByRole("button", { name: "Make it mine — 15 min, once" }),
  ).toBeVisible();

  return { calls, errors, setupCard };
}

async function stageHarnessAuth(page) {
  await page.waitForFunction(
    () =>
      !!globalThis.__JOBBORED_E2E_GIS__ &&
      typeof globalThis.JobBoredApp?.core?.host?.initAuth === "function",
  );
  await page.evaluate(({ clientId }) => {
    const host = globalThis.JobBoredApp.core.host;
    host.mergeStoredConfigOverridePatch({ oauthClientId: clientId });
    host.initAuth();
  }, AUTH);
  await expect
    .poll(() =>
      page.evaluate(
        () => globalThis.__JOBBORED_E2E_GIS__?.init?.clientId || "",
      ),
    )
    .toBe(CLIENT_ID);
}

function expectCleanRun(state) {
  expect(state.calls.violations, "network boundary contract violations").toEqual([]);
  expect(state.calls.unexpectedExternal, "unexpected external requests").toEqual([]);
  expect(state.errors, "browser console/page errors").toEqual([]);
}

test("VAL-ONEFLOW-001: six beats reach the payoff on a fresh install", async ({ page }) => {
  const state = await bootGreenfield(page);

  await state.setupCard
    .getByRole("button", { name: "Make it mine — 15 min, once" })
    .click();
  await expect(beat(page, "google")).toBeVisible();

  await stageHarnessAuth(page);
  await page.getByRole("button", { name: "Continue with Google" }).click();
  await expect(beat(page, "ai")).toBeVisible();
  await expect.poll(() => state.calls.userinfo.length).toBe(1);

  const gis = await page.evaluate(() => globalThis.__JOBBORED_E2E_GIS__);
  expect(gis.init.clientId).toBe(CLIENT_ID);
  expect(gis.init.scope.split(/\s+/).sort()).toEqual([...GOOGLE_SCOPES].sort());
  expect(gis.init.includeGrantedScopes).toBe(true);
  expect(gis.requests).toEqual([{ prompt: "consent" }]);
  expect(state.calls.sheetsCreate).toHaveLength(1);
  expect(state.calls.sheetsHeaders).toHaveLength(1);

  const openrouter = beat(page, "ai").locator('[data-provider="openrouter"]');
  await expect(openrouter).toHaveAttribute("aria-pressed", "true");
  await beat(page, "ai")
    .getByLabel("OpenRouter — free API key")
    .fill(OPENROUTER_KEY);
  await page.getByRole("button", { name: "Check & continue" }).click();
  await expect(beat(page, "resume")).toBeVisible();
  expect(state.calls.openrouterChecks).toHaveLength(1);
  expect(state.calls.llmConfigPins).toHaveLength(1);

  await page
    .getByRole("button", { name: "I'd rather start from a template" })
    .click();
  await beat(page, "resume").locator('[data-template-id="engineer"]').click();
  await expect(beat(page, "fit")).toBeVisible();
  expect(state.calls.profileTemplates).toHaveLength(1);

  await page.getByRole("button", { name: "Looks like me →" }).click();
  await expect(beat(page, "discovery")).toBeVisible();
  expect(state.calls.profileWrites).toHaveLength(1);

  await beat(page, "discovery")
    .getByLabel("SerpApi API key")
    .fill(SERPAPI_KEY);
  await page.getByRole("button", { name: "Save & verify" }).click();
  const skipConnection = page.locator(
    '#oneFlowMount [data-action-id="oneflow_discovery_skip_connect"]',
  );
  await expect(skipConnection).toBeEnabled();
  await skipConnection.click();
  await expect(beat(page, "payoff")).toBeVisible();

  expect(state.calls.serpApiChecks).toHaveLength(1);
  expect(state.calls.discoveryEnvWrites).toHaveLength(1);
  expect(state.calls.discoveryBoots).toHaveLength(1);

  const payoffPrimary = page.locator(
    '#oneFlowMount [data-action-id="payoff_run_now"], ' +
      '#oneFlowMount [data-action="payoff_run_now"], ' +
      '#oneFlowMount [data-action-id="payoff_connect_google"], ' +
      '#oneFlowMount [data-action="payoff_connect_google"], ' +
      '#oneFlowMount [data-action-id="payoff_fix_fit"], ' +
      '#oneFlowMount [data-action="payoff_fix_fit"]',
  );
  await expect(payoffPrimary).toBeVisible();

  expectCleanRun(state);
});
