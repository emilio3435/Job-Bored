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
// GFX D3: Gemini is the pre-selected B2 card, so the walk checks a Gemini key.
const GEMINI_KEY = "AIza-jobbored-onboarding-e2e-fake";
const GEMINI_ENV_KEY = "BROWSER_USE_DISCOVERY_GEMINI_API_KEY";
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
  "Search Match",
  "Favorite",
  "Dismissed At",
  "Approval Status",
  "Edit Lock",
  "Work Mode",
];
/** What POST /profile/contact/suggest answers (server/profile-identity.mjs shape). */
const CONTACT_SUGGESTION = {
  ok: true,
  source: "stored",
  suggestions: {
    fullName: { value: "Jordan Rivera", confidence: 0.9 },
    headline: { value: "Backend Engineer", confidence: 0.5 },
    email: { value: "jordan.rivera@example.com", confidence: 0.95 },
    phone: null,
    location: { value: { city: "Austin", state: "TX" }, confidence: 0.8 },
    links: {
      linkedin: { value: "https://linkedin.com/in/jordan-rivera", confidence: 0.9 },
      website: null,
      github: null,
      other: [],
    },
  },
  values: {
    fullName: "Jordan Rivera",
    headline: "Backend Engineer",
    email: "jordan.rivera@example.com",
    location: { city: "Austin", state: "TX" },
    links: { linkedin: "https://linkedin.com/in/jordan-rivera" },
  },
};

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
    geminiChecks: [],
    geminiEnvWrites: [],
    llmConfigPins: [],
    profileTemplates: [],
    profileCommits: [],
    serpApiChecks: [],
    discoveryEnvWrites: [],
    discoveryBoots: [],
    ollamaModels: [],
    violations: [],
    unexpectedExternal: [],
    contactSuggests: [],
    contactWrites: [],
    voiceReads: [],
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

    if (url.origin === baseUrl && method === "POST" && url.pathname === "/profile/commit") {
      const body = request.postDataJSON();
      calls.profileCommits.push(body);
      await fulfillJson(route, { ok: true, replayed: false, commitId: body.commitId, mode: body.mode, revision: "onboarding-e2e-revision" });
      return;
    }

    // Fit can offer a saved setup, but this fresh install has none.
    if (url.origin === baseUrl && method === "GET" && url.pathname === "/profile/commit/state") {
      await fulfillJson(route, { ok: true, exists: false, revision: "empty", accountHash: null });
      return;
    }
    // JOBQA: details are entered here when no resume was staged. Keep the
    // old suggestion boundary observable so an accidental read is caught.
    if (url.origin === baseUrl && method === "GET" && url.pathname === "/profile") {
      await fulfillJson(route, { ok: false, reason: "no_profile" });
      return;
    }
    if (url.origin === baseUrl && method === "POST" && url.pathname === "/profile/contact/suggest") {
      calls.contactSuggests.push(request.postDataJSON());
      await fulfillJson(route, CONTACT_SUGGESTION);
      return;
    }
    if (url.origin === baseUrl && method === "POST" && url.pathname === "/profile/contact") {
      calls.contactWrites.push(request.postDataJSON());
      await fulfillJson(
        route,
        { ok: false, reason: "no_profile", message: "Save your fit profile first, then your details." },
        409,
      );
      return;
    }
    // JOBQA: onboarding never reads a saved guide. This boundary remains
    // observable, and the walk skips voice without committing one.
    if (url.origin === baseUrl && method === "GET" && url.pathname === "/profile/voice") {
      calls.voiceReads.push(url.pathname);
      await fulfillJson(route, { ok: true, exists: false, text: "", updatedAt: null, words: 0 });
      return;
    }
    // Nothing under /profile may reach the dev server's proxy to the real
    // local API on this machine.
    if (url.origin === baseUrl && (url.pathname === "/profile" || url.pathname.startsWith("/profile/"))) {
      calls.violations.push(`unstubbed host path ${method} ${url.pathname}`);
      await fulfillJson(route, { ok: false, hermetic: true }, 503);
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
      // GFX B2-4: B2's Gemini write-through, after the inline "Save it".
      if (body?.key === GEMINI_ENV_KEY) {
        calls.geminiEnvWrites.push(body);
        if (method !== "POST") calls.violations.push(`Gemini env method ${method}`);
        if (body?.value !== GEMINI_KEY) calls.violations.push("Gemini env payload");
        await fulfillJson(route, { ok: true });
        return;
      }
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

    if (url.origin === baseUrl && url.pathname === "/__proxy/ping") {
      // GFX §R3: a current build's ping names its version and routes;
      // a bare { ok: true } now reads as a stale server.
      await fulfillJson(route, {
        ok: true,
        version: "0.1.0",
        runtime: "source",
        routes: ["ping", "serpapi-check"],
      });
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
        if (range !== "Pipeline!A1:Z1") {
          calls.violations.push(`starter header URL range ${range || "missing"}`);
        }
        if (url.searchParams.get("valueInputOption") !== "RAW") {
          calls.violations.push("starter header valueInputOption");
        }
        if (body?.range !== "Pipeline!A1:Z1") {
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
          updatedRange: "Pipeline!A1:Z1",
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
      url.origin === "https://generativelanguage.googleapis.com" &&
      /^\/v1beta\/models\/[^/]+:generateContent$/.test(url.pathname)
    ) {
      if (method === "OPTIONS") {
        await route.fulfill({ status: 204, headers: jsonHeaders() });
        return;
      }
      const key = request.headers()["x-goog-api-key"] || "";
      calls.geminiChecks.push({ method, path: url.pathname });
      if (method !== "POST") calls.violations.push(`Gemini check method ${method}`);
      if (key !== GEMINI_KEY) calls.violations.push("Gemini check key");
      if (url.search) calls.violations.push("Gemini check put something in the URL query");
      await fulfillJson(route, {
        candidates: [{ content: { parts: [{ text: "ok" }] } }],
      });
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

/** The shell stamps every beat action with `data-action-id`. */
function action(page, id) {
  return page.locator(`#oneFlowMount [data-action-id="${id}"]`);
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
    setupCard.getByText(
      "Set it up once. It takes about 20–25 minutes, and you'll need:",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    setupCard.getByRole("button", { name: "Make it mine", exact: true }),
  ).toBeVisible();

  return { calls, errors, setupCard };
}

async function stageHarnessAuth(page) {
  // bridge-registry.js splits the host by consumer: initAuth is published on
  // JobBoredApp.bootstrap.host (:212) and the config-override writer on
  // JobBoredApp.core.host (:566). Waiting on core.host.initAuth waits forever.
  await page.waitForFunction(
    () =>
      !!globalThis.__JOBBORED_E2E_GIS__ &&
      typeof globalThis.JobBoredApp?.bootstrap?.host?.initAuth === "function",
  );
  // Lane C's Beat 1 detour is the ONLY visible route to a Client ID on a
  // fresh install, and lane F made saving one run the first-time GIS init.
  const detour = page.locator("#oneFlowMount details.oneflow-google__detour");
  // GFX G1: with no Client ID the detour starts open, so a summary click
  // would CLOSE it. Open it only if it isn't already. (It nests C7's
  // "Having trouble?" details; this targets the detour itself.)
  if (!(await detour.evaluate((node) => node.open))) {
    await detour.locator("summary.oneflow-google__detour-summary").click();
  }
  await page.locator("#oneFlowOauthClientIdInput").fill(CLIENT_ID);
  await page.getByRole("button", { name: "Save Client ID" }).click();
  await expect(
    page.getByText("Client ID saved. Continue with Google below.", {
      exact: true,
    }),
  ).toBeVisible();
  // The visible save persists the id but does NOT arm GIS on a greenfield
  // boot: applyOAuthClientChange() returns false (gisLoaded is still false),
  // and the first-time init lane F added behind it — oneflow-beat-google.js:377
  // `call("initAuth")` — resolves against window.JobBoredApp.core.host, which
  // bridge-registry.js publishes WITHOUT initAuth (it lives on
  // app.bootstrap.host, :212). Probed on this branch: core.host.initAuth is
  // undefined, applyOAuthClientChange() === false, gisLoaded === false.
  // Until that line reaches the bootstrap host, the journey has to arm GIS
  // itself through the bridge seam that does exist.
  await page.evaluate(() => globalThis.JobBoredApp.bootstrap.host.initAuth());
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

test("VAL-ONEFLOW-001: every beat reaches the payoff on a fresh install", async ({ page }) => {
  const state = await bootGreenfield(page);

  await state.setupCard
    .getByRole("button", { name: "Make it mine", exact: true })
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

  // GFX D3: Gemini is first and pre-selected.
  const gemini = beat(page, "ai").locator('[data-provider="gemini"]');
  await expect(gemini).toHaveAttribute("aria-pressed", "true");
  await beat(page, "ai").getByLabel("Gemini API key").fill(GEMINI_KEY);
  await page.getByRole("button", { name: "Check & continue" }).click();
  // GFX B2-4 / B2-5: a passed check asks inline before anything is saved
  // on this computer — no native dialog, no write yet.
  await expect(
    beat(page, "ai").getByText(
      "Also save this key on this computer so drafting, scoring and discovery can use it?",
      { exact: true },
    ),
  ).toBeVisible();
  expect(state.calls.geminiChecks).toHaveLength(1);
  expect(state.calls.llmConfigPins).toHaveLength(0);
  expect(state.calls.geminiEnvWrites).toHaveLength(0);
  await page.getByRole("button", { name: "Save it", exact: true }).click();
  await expect(
    beat(page, "ai").getByText("Want a second opinion? (optional)", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Skip for now", exact: true }).click();
  await expect(beat(page, "resume")).toBeVisible();
  expect(state.calls.llmConfigPins).toHaveLength(1);
  expect(state.calls.llmConfigPins[0].provider).toBe("gemini");
  expect(state.calls.llmConfigPins[0].apiKey).toBe(GEMINI_KEY);
  expect(state.calls.geminiEnvWrites).toHaveLength(1);
  expect(state.calls.openrouterChecks).toHaveLength(0);

  await page
    .getByRole("button", { name: "I'd rather start from a template" })
    .click();
  await beat(page, "resume").locator('[data-template-id="engineer"]').click();
  // A template supplies fit defaults, not a staged resume: enter fictional
  // contact details, then carry them into the single profile commit.
  await expect(beat(page, "details")).toBeVisible();
  expect(state.calls.profileTemplates).toHaveLength(1);
  const details = beat(page, "details");
  await expect(details.locator(".jb-details")).toHaveAttribute("data-prefill", "done");
  await expect(details.getByLabel("Full name", { exact: true })).toHaveValue("");
  await expect(details.getByLabel("Email", { exact: true })).toHaveValue("");
  await details.getByLabel("Full name", { exact: true }).fill("Jordan Rivera");
  await details.getByLabel("Email", { exact: true }).fill("jordan.rivera@example.com");
  await details.getByLabel("Headline", { exact: true }).fill("Staff Backend Engineer");
  await details.getByLabel("LinkedIn", { exact: true }).fill("https://linkedin.com/in/jordan-rivera");
  await page.getByRole("button", { name: "Confirm my details →" }).click();
  // "Your voice" follows: skipped here (the voice spec covers staging),
  // and it stays unfinished on the spine.
  await expect(beat(page, "voice")).toBeVisible();
  await expect(beat(page, "voice").locator(".oneflow-voice")).toHaveAttribute("data-load", "done");
  expect(state.calls.voiceReads).toHaveLength(0);
  await page.getByRole("button", { name: "Skip for now" }).click();
  await expect(beat(page, "fit")).toBeVisible();
  expect(state.calls.contactSuggests).toHaveLength(0);
  expect(state.calls.contactWrites).toHaveLength(0);
  expect(state.calls.profileCommits).toHaveLength(0);

  await page.getByRole("button", { name: "Looks like me →" }).click();
  await expect(beat(page, "discovery")).toBeVisible();
  expect(state.calls.profileCommits).toHaveLength(1);
  const commit = state.calls.profileCommits[0];
  expect(commit.commitId).toMatch(/^onb-/);
  expect(commit.mode).toBe("create");
  expect(commit.noResume).toBe(true);
  expect(commit).not.toHaveProperty("resumeText");
  expect(commit).not.toHaveProperty("voice");
  const savedIdentity = commit.profile.identity;
  expect(savedIdentity.fullName).toBe("Jordan Rivera");
  expect(savedIdentity.headline).toBe("Staff Backend Engineer");
  expect(savedIdentity.email).toBe("jordan.rivera@example.com");
  expect(savedIdentity.links.linkedin).toBe("https://linkedin.com/in/jordan-rivera");

  await beat(page, "discovery")
    .getByLabel("SerpApi API key")
    .fill(SERPAPI_KEY);
  const fuelConsent = page.waitForEvent("dialog").then(async (dialog) => {
    const message = dialog.message();
    await dialog.accept();
    return message;
  });
  await page.getByRole("button", { name: "Save & verify" }).click();
  const consentMessage = await fuelConsent;
  expect(consentMessage).toContain("Save & verify");
  expect(consentMessage).toContain("SERPAPI_API_KEY");
  expect(consentMessage).toContain("restart your local discovery worker");
  const skipConnection = page.locator(
    '#oneFlowMount [data-action-id="oneflow_discovery_skip_connect"]',
  );
  await expect(skipConnection).toBeEnabled();
  await skipConnection.click();
  await expect(beat(page, "payoff")).toBeVisible();

  expect(state.calls.serpApiChecks).toHaveLength(1);
  expect(state.calls.discoveryEnvWrites).toHaveLength(1);
  expect(state.calls.discoveryBoots).toHaveLength(1);

  // Beat 6's primary is decided twice over (oneflow-beat-payoff.js
  // buildActions): the connect SKIP flips it first (spec §5 B6), and only an
  // unskipped payoff adapts to readiness (GREENFIELD-SPEC §4.3). This walk
  // skipped the connection, so the honest primary is the dashboard and the
  // ghost is the way back to it.
  await expect(action(page, "payoff_dashboard")).toHaveText("Go to my dashboard");
  await expect(action(page, "payoff_connect_discovery")).toBeVisible();

  // …and the walk really did earn a Sheet and roles: neither readiness
  // detour renders, so nothing here is asking for work already done.
  await expect(action(page, "payoff_connect_google")).toHaveCount(0);
  await expect(action(page, "payoff_fix_fit")).toHaveCount(0);
  await expect(beat(page, "payoff")).toContainText("Pipeline sheet connected");
  await expect(beat(page, "payoff")).toContainText("AI connected — Gemini");

  expectCleanRun(state);
});
